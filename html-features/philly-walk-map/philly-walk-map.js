/**
 * Shared Philadelphia walking-map box for Coffee Map, Philly Dates, and future apps.
 *
 * Walking around Philly: north of the Navy Yard, south of Fishtown / Olde Kensington,
 * west through 45th St, east of the river (not Camden), including Brewerytown
 * around the Art Museum.
 *
 * Also: one-shot “Where am I” (getCurrentPosition only — never watchPosition).
 */
(function (root) {
  'use strict';

  var B = {
    south: 39.885,
    north: 39.984,
    west: -75.214,
    east: -75.118
  };

  var WALK_M_PER_MIN = 80;
  var HERE_MIN_DEFAULT = 10;
  var HERE_MIN_LO = 5;
  var HERE_MIN_HI = 25;

  function metersForWalkMinutes(min) {
    min = Number(min);
    if (!isFinite(min) || min < 0) min = 0;
    return min * WALK_M_PER_MIN;
  }

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var R = 6371000;
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function locateOnce(onOk, onErr) {
    if (!navigator.geolocation) {
      if (onErr) onErr(new Error('Location is not available on this device'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        if (onOk) {
          onOk({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        }
      },
      function (err) {
        if (onErr) onErr(err || new Error('Could not get location'));
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 12000
      }
    );
  }

  function locateErrorMessage(err) {
    if (!err) return 'Could not get location';
    if (err.code === 1) return 'Location permission denied';
    if (err.code === 2) return 'Location unavailable';
    if (err.code === 3) return 'Location timed out';
    return err.message || 'Could not get location';
  }

  function formatWalkLabel(minutes) {
    minutes = Math.round(Number(minutes) || 0);
    var m = metersForWalkMinutes(minutes);
    var shown = m >= 1000 ? ('~' + (m / 1000).toFixed(1) + ' km') : ('~' + Math.round(m) + ' m');
    return shown + ' · ' + minutes + ' min walk';
  }

  /**
   * Owns a temporary you-pin + walk circle on a Leaflet map.
   * Never stores coordinates. Call clear() when leaving the map.
   */
  function attachHereControl(map, opts) {
    opts = opts || {};
    var state = {
      active: false,
      lat: null,
      lng: null,
      minutes: HERE_MIN_DEFAULT,
      locating: false
    };
    var marker = null;
    var circle = null;
    var layer = null;

    function emit() {
      if (opts.onChange) {
        opts.onChange({
          active: state.active,
          lat: state.lat,
          lng: state.lng,
          minutes: state.minutes,
          meters: metersForWalkMinutes(state.minutes),
          locating: state.locating
        });
      }
    }

    function ensureLayer() {
      if (!layer && typeof L !== 'undefined' && map) {
        layer = L.layerGroup().addTo(map);
      }
      return layer;
    }

    function draw() {
      if (!state.active || state.lat == null || typeof L === 'undefined' || !map) return;
      ensureLayer();
      var latlng = [state.lat, state.lng];
      var radius = metersForWalkMinutes(state.minutes);
      if (!marker) {
        marker = L.circleMarker(latlng, {
          radius: 9,
          color: '#fff',
          weight: 3,
          fillColor: '#1d4ed8',
          fillOpacity: 1,
          interactive: false
        }).addTo(layer);
      } else {
        marker.setLatLng(latlng);
      }
      if (!circle) {
        circle = L.circle(latlng, {
          radius: radius,
          color: '#2563eb',
          weight: 2,
          opacity: 0.85,
          fillColor: '#3b82f6',
          fillOpacity: 0.14,
          interactive: false
        }).addTo(layer);
      } else {
        circle.setLatLng(latlng);
        circle.setRadius(radius);
      }
    }

    function clear() {
      state.active = false;
      state.lat = null;
      state.lng = null;
      state.locating = false;
      if (layer) {
        layer.clearLayers();
      }
      marker = null;
      circle = null;
      emit();
    }

    function setMinutes(min) {
      min = Math.round(Number(min));
      if (!isFinite(min)) min = HERE_MIN_DEFAULT;
      if (min < HERE_MIN_LO) min = HERE_MIN_LO;
      if (min > HERE_MIN_HI) min = HERE_MIN_HI;
      state.minutes = min;
      if (state.active) draw();
      emit();
    }

    function placeAt(lat, lng) {
      state.lat = lat;
      state.lng = lng;
      state.active = true;
      state.locating = false;
      draw();
      if (map && typeof map.panTo === 'function') {
        map.panTo([lat, lng]);
      }
      emit();
    }

    function locate() {
      if (state.locating) return;
      state.locating = true;
      emit();
      locateOnce(
        function (fix) {
          placeAt(fix.lat, fix.lng);
        },
        function (err) {
          state.locating = false;
          emit();
          if (opts.onError) opts.onError(locateErrorMessage(err));
        }
      );
    }

    function countWithin(places) {
      if (!state.active || state.lat == null) return 0;
      var meters = metersForWalkMinutes(state.minutes);
      var n = 0;
      (places || []).forEach(function (p) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
        if (haversineMeters(state.lat, state.lng, p.lat, p.lng) <= meters) n += 1;
      });
      return n;
    }

    function isWithin(lat, lng) {
      if (!state.active || state.lat == null) return true;
      return haversineMeters(state.lat, state.lng, lat, lng) <= metersForWalkMinutes(state.minutes);
    }

    return {
      locate: locate,
      clear: clear,
      setMinutes: setMinutes,
      getState: function () {
        return {
          active: state.active,
          lat: state.lat,
          lng: state.lng,
          minutes: state.minutes,
          meters: metersForWalkMinutes(state.minutes),
          locating: state.locating
        };
      },
      isActive: function () { return state.active; },
      countWithin: countWithin,
      isWithin: isWithin,
      formatLabel: function () { return formatWalkLabel(state.minutes); }
    };
  }

  var api = {
    id: 'philly-walk-map',
    label: 'Philly walking map',
    bounds: B,
    center: { lat: 39.9526, lng: -75.1636 },
    minZoom: 13,
    defaultZoom: 13,
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileAttribution: '&copy; OpenStreetMap',
    WALK_M_PER_MIN: WALK_M_PER_MIN,
    HERE_MIN_DEFAULT: HERE_MIN_DEFAULT,
    HERE_MIN_LO: HERE_MIN_LO,
    HERE_MIN_HI: HERE_MIN_HI,

    contains: function (lat, lng) {
      lat = Number(lat);
      lng = Number(lng);
      if (!isFinite(lat) || !isFinite(lng)) return false;
      return lat >= B.south && lat <= B.north && lng >= B.west && lng <= B.east;
    },

    photonBbox: function () {
      return [B.west, B.south, B.east, B.north].join(',');
    },

    latLngBounds: function () {
      return [[B.south, B.west], [B.north, B.east]];
    },

    addTiles: function (map) {
      if (typeof L === 'undefined' || !map) return null;
      return L.tileLayer(api.tileUrl, {
        maxZoom: 19,
        attribution: api.tileAttribution
      }).addTo(map);
    },

    applyLimits: function (map) {
      if (!map) return;
      map.setMaxBounds(api.latLngBounds());
      if (typeof map.setMinZoom === 'function') map.setMinZoom(api.minZoom);
    },

    fit: function (map, padding) {
      if (!map || typeof L === 'undefined') return;
      map.fitBounds(api.latLngBounds(), {
        padding: padding || [28, 28],
        maxZoom: 14
      });
    },

    metersForWalkMinutes: metersForWalkMinutes,
    haversineMeters: haversineMeters,
    locateOnce: locateOnce,
    locateErrorMessage: locateErrorMessage,
    formatWalkLabel: formatWalkLabel,
    attachHereControl: attachHereControl
  };

  root.PhillyWalkMap = api;
})(typeof window !== 'undefined' ? window : this);
