/**
 * Shared Philadelphia walking-map box for Coffee Map, Philly Dates, and future apps.
 *
 * Walking around Philly: north of Oregon Ave, south of Fishtown / Olde Kensington,
 * west through 45th St, east of the river (not Camden), including Brewerytown
 * around the Art Museum.
 */
(function (root) {
  'use strict';

  var B = {
    south: 39.914,
    north: 39.984,
    west: -75.214,
    east: -75.118
  };

  var api = {
    id: 'philly-walk-map',
    label: 'Philly walking map',
    bounds: B,
    center: { lat: 39.9526, lng: -75.1636 },
    minZoom: 13,
    defaultZoom: 13,
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileAttribution: '&copy; OpenStreetMap',

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
    }
  };

  root.PhillyWalkMap = api;
})(typeof window !== 'undefined' ? window : this);
