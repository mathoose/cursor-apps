#!/usr/bin/env python3
"""Merge 14-team FFC ADP with BDGE video notes. Newest video wins the verdict."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ADP = json.loads(Path("/tmp/adp/players_base.json").read_text())

SOURCES = {
    "week2": {"label": "Preseason week 2", "order": 1, "id": "3PL4i_fy3NU"},
    "strategy": {"label": "Picks 1–4 strategy", "order": 2, "id": "hIQIkhGlrww"},
    "rookies": {"label": "Rookies", "order": 3, "id": "n9kJSeO4naM"},
    "week1": {"label": "Preseason week 1", "order": 4, "id": "JDNJJO6ituM"},
    "camp": {"label": "Camp ranking changes", "order": 5, "id": "ciw9TnF4vWM"},
    "top50": {"label": "Top 50 & tiers", "order": 6, "id": "LL6cuiAP8lc"},
}

# Newest-first notes. stance: do | dont | watch | split | take
# "take" = click at ADP / your window; "do" = target vs ADP; "dont" = fade/avoid
NOTES = [
    ("Jahmyr Gibbs", ["gibbs"], [
        ("week2", "take", "Still the clean 1.01. Nick’s mocks from pick 1 start Gibbs, then two WRs at the 2–3 turn."),
        ("strategy", "take", "Gibbs or Bijan open almost every draft. From 1.01 this is the free pick. Hero RB: take the elite back, then load receivers."),
        ("top50", "take", "Official 1.01 in full PPR 1QB. Bellcow in Detroit with continuity; expects an explosion."),
    ]),
    ("Bijan Robinson", ["bijan"], [
        ("strategy", "take", "The other 1.01-quality RB. If Gibbs is gone he’s the pick; Nick’s 1.02 mock was Bijan then London/Nabers."),
        ("top50", "take", "Tier 1 but behind Gibbs and Puka on Nick’s board. Elite, slightly less trusted situation than Puka."),
    ]),
    ("Puka Nacua", ["puka"], [
        ("strategy", "watch", "Elite, but taking Chase/Puka at 1.01 in a 2-WR league leaves you thin at RB by the 2–3 turn. Better as a 3/4 pick or if you specifically want Zero-RB."),
        ("top50", "do", "Nick’s 1.02. Biggest board-vs-field gap at the top. Trusts Rams more than Bijan’s situation."),
    ]),
    ("Ja'Marr Chase", ["jamarr chase", "ja marr chase"], [
        ("strategy", "watch", "If you take him 1.01, the next-tier RBs are often gone by 2.14. Nick’s pick-3 mock (Chase then Nabers) left an ugly RB room. In 2-WR + flex, prefer Gibbs."),
        ("top50", "take", "Tier-2 elite WR with CeeDee after the top three."),
    ]),
    ("Christian McCaffrey", ["cmc", "mccaffrey"], [
        ("week2", "watch", "Age + injury history. Shanahan RB2s become studs — grab Kalin Black or Jordan James last round if you take him."),
        ("strategy", "do", "If you’re 3/4, he argued reaching CMC over going WR-WR so you don’t end up with Swift/Rhamondre as your RBs. You are 1.01 so this is a later-board issue."),
    ]),
    ("Jonathan Taylor", ["jt"], [
        ("camp", "take", "Colts keep a field-stretcher (Pierce) so Taylor can get ~20 carries. Not a fade."),
        ("top50", "take", "Small tier with James Cook around 9–10."),
    ]),
    ("James Cook", ["james cook iii", "james cook"], [
        ("week2", "do", "Ty Johnson mystery lower-body injury is sneaky huge. Johnson played 70%+ of 3rd downs last year and capped Cook’s receiving. If Johnson misses time / PUP, Cook’s ceiling jumps to true bellcow. Monitor, then smash."),
        ("strategy", "do", "Fine to start Cook at 1.04 in mocks. Workhorse tier at the 1–2 turn."),
        ("top50", "do", "RB9, three spots above consensus. Wants ~48–50 catches with Carmichael/Brady. Bills scoring environment."),
    ]),
    ("De'Von Achane", ["achane", "devon achane"], [
        ("top50", "dont", "Eleven spots below consensus. Loves the player, will not roster at ADP: mobile QB, bad team, TD scarcity, needs 90th-percentile explosives."),
        ("strategy", "watch", "Lives in the 1–2 turn RB heap. Don’t take him over Gibbs/Bijan and don’t reach at 28."),
    ]),
    ("Ashton Jeanty", ["jeanty", "genty"], [
        ("week2", "watch", "They like Jeanty as the Raiders offense. Without him the room is ugly — don’t smash Mike Washington assuming a Jeanty injury creates a gold mine."),
        ("week1", "take", "Used as a positive tape comp; Geno targeted him ~75 times last year (context for Breece)."),
    ]),
    ("Derrick Henry", ["henry"], [
        ("strategy", "take", "Last RB of the early tier. Nick got lucky Henry fell to 2.09 in a Puka start. Fine if he reaches you at 28; don’t panic-take Jacobs instead."),
        ("top50", "take", "In the Saquon–Bowers cluster. Baltimore still run-heavy with Henry inside the 10."),
    ]),
    ("Saquon Barkley", ["saquon"], [
        ("week1", "take", "Rested; Tank Bigsby took every snap — Tank is the locked cuff."),
        ("top50", "do", "Starts tier 5 at 11. Prefers trusted-offense RBs like Saquon/Walker."),
    ]),
    ("Kenneth Walker", ["kenneth walker iii", "kenneth walker", "k dubs"], [
        ("week2", "do", "Still trying to get him end of 1–2 turn. Week 2 Chiefs rotation got messier (DeMarcato then Emmett). Still the lead back."),
        ("week1", "do", "One play-action snap then off. Target at the 1–2 turn."),
        ("top50", "do", "Nick’s stamp guy: 12th overall, five above ADP. Chiefs bellcow, $43M deal. Same energy as last year’s Achane call."),
    ]),
    ("Omarion Hampton", ["hampton", "omari hampton"], [
        ("week2", "take", "Still early 2nd / ~16 overall behind KW3 and Chase Brown. Chargers interior OL lost their Washington signing to ACL; line dropped ~top 6–7 to ~10. McDaniel can scheme around it. Fine to stack Keaton Mitchell last round."),
        ("week1", "take", "The Chargers skill player (with Ladd) they will still spend capital on."),
    ]),
    ("Chase Brown", ["chase brown"], [
        ("top50", "take", "In the mid-tier 5 RB cluster. No fade."),
    ]),
    ("Jeremiyah Love", ["jeremiah love", "jeremiyah love"], [
        ("strategy", "watch", "Was a great 2–3 turn pick; now a high-ankle sprain. Don’t force him at 28–29."),
        ("rookies", "watch", "His RB1 of the class. High-ankle after heavy preseason. Was 2–3 turn; now 3–4 / early-mid 4th. Allgeier will nibble early downs/goal line. Playoff slate is a carrot if healthy."),
        ("week1", "do", "Bellcow vs Allgeier: 71% snaps, 80% routes, inside-the-10 work. Volume RB even if top-5 upside is capped — that was pre-sprain."),
        ("top50", "watch", "On the board in the WR cluster; sprain is the limiter."),
    ]),
    ("Josh Jacobs", ["jacobs"], [
        ("strategy", "dont", "Missed camp, possible suspension still in play, Packers OL poor, MarShawn Lloyd looming. Nick did not want him as a pure RB1 over Nico. Don’t take him at 28–29 over a WR1."),
        ("week1", "watch", "Groin; Lloyd played every starter snap. Cuff is valuable."),
        ("top50", "watch", "High-floor/boring around 29. Legal situation unresolved. If active he’s still GB’s RB1."),
    ]),
    ("Kyren Williams", ["kyren"], [
        ("strategy", "watch", "Available at the 2–3 turn. Nick likes him but doesn’t see that upside matching Nabers/AJ Brown."),
        ("top50", "dont", "Won’t invest like the last two years. Corum split drives down the stretch; take Kyren only if he falls to the 4th."),
    ]),
    ("Breece Hall", ["breece", "bree hall", "bruce hall"], [
        ("week2", "take", "Groin strain, out rest of preseason, ‘multiple weeks.’ Not dropping him. If targeting an RB in the 3rd he is a priority; even viable in the 2nd. Injury looks precautionary. Setup still Jets-capped, not injury-capped."),
        ("week1", "do", "10 of 11 starter snaps, bellcow. Geno should restore receiving work after Fields."),
        ("top50", "dont", "Below consensus (mid-3rd ADP). Trusts the player more than last year but not Aaron Glenn. Prefer Breece over Garrett Wilson if taking a Jet."),
    ]),
    ("Cam Skattebo", ["skattebo", "scataboo", "skatabou"], [
        ("week2", "take", "Najee signing did not get them off Skattebo. Slightly less willing to reach. Still the Giant they want. Do not draft anyone behind him."),
        ("week1", "take", "Weird 5/7/4 rotation with Tracy/Singletary — throw it out. Still in."),
        ("top50", "do", "Rank 39. Expects Giants bellcow: goal-line ram + pass catcher. Hang-up is Nagy/Greg Roman ‘too many chefs.’"),
    ]),
    ("Javonte Williams", ["javonte"], [
        ("strategy", "watch", "Available 2–3 turn. Fine player, not the upside of the WR cluster there."),
        ("top50", "take", "Boring high-floor around 32."),
    ]),
    ("Travis Etienne", ["etienne", "etn", "travis etienne jr", "travis etienne"], [
        ("week2", "do", "Biggest riser. Kamara MCL, out ~a month+. Nick 36 overall / top-15 RB / late 3rd; Michael early 4th. ~70% snaps (Nick thinks ~80% to start). Saints OL + Kellen Moore. Committee likely later when Kamara returns."),
        ("strategy", "do", "Incredible value when he fell to 5.02 in a mock. 4–5 turn RBs got more appealing after injuries."),
        ("top50", "take", "Closes the top 50 at 50 — that was before the Kamara news. Treat week 2 as the update."),
    ]),
    ("Alvin Kamara", ["kamara", "chimera"], [
        ("week2", "dont", "MCL sprain, out at least a month. ‘Done / toast.’ Declining rusher, bad in the passing game, liability in pass pro. Name-value trap. At most a midseason annoyance for ETN."),
    ]),
    ("Tyrone Tracy", ["tracy"], [
        ("week2", "dont", "Nuked / undraftable. Lost the start to Singletary, then fumbled. Don’t bother."),
        ("week1", "watch", "Co-starter noise and 7 of 16 snaps — they said don’t overreact then. Week 2 tape ended that."),
    ]),
    ("Devin Singletary", ["singletary"], [
        ("week2", "dont", "Started week 2 while Skattebo rested. Still not a real role. Messy if Skattebo misses time."),
        ("week1", "dont", "Four starter snaps — throw it out."),
    ]),
    ("Najee Harris", ["naji harris", "najiar"], [
        ("week2", "dont", "1-year $1.2M, no guarantee, coming off Achilles, not even practicing. As likely to miss the roster as to have a huge role. Don’t invest."),
    ]),
    ("Tony Pollard", ["pollard"], [
        ("week1", "dont", "Split with Spears. Nick moved him to ~RB27–28: even a hit is low-end RB2 at an RB23 price. Spend that capital on WR upside or LaPorta/Kraft."),
    ]),
    ("Tyjae Spears", ["spears", "tajae"], [
        ("week1", "do", "More starter work than Pollard in the split. Late-round RB flyer, Titans want ~60/40 if he’s healthy."),
    ]),
    ("Jonathan Brooks", ["jonathan brooks", "jonathon brooks"], [
        ("week2", "do", "Clear Chuba fill-in: 75–80% if Chuba sits, goal line, inside-the-5/10. Condensed Carolina offense."),
        ("week1", "watch", "Almost all snaps with Bryce while Hubbard was out. Michael ~77 overall; Nick wants him as a back-end 8th, not a 6th unless Hubbard misses Week 1."),
    ]),
    ("Chuba Hubbard", ["chuba", "hubbard"], [
        ("week1", "dont", "Hamstring, week-to-week. Michael wasn’t drafting him anyway. Nick thinks he’s entrenched and returns to a 1A/1B rather than losing the job."),
    ]),
    ("RJ Harvey", ["r.j. harvey", "harvey"], [
        ("week2", "split", "Michael: 8th/9th bench dart, Payton loves throwing to RBs, designed screen + 21-yard wheel TD. Nick: limited early-down trust, Dobbins + Jonah Coleman cap the ceiling. Prefer the discount vs TreVeyon at 4/5, but Nick may never click him."),
    ]),
    ("Jonah Coleman", ["coleman"], [
        ("week2", "watch", "Gets the 2nd drive; early-down heir if Dobbins sits. Caps Harvey’s workhorse path."),
        ("rookies", "watch", "4th-round bowling ball. If Dobbins goes down, Coleman takes early downs so they don’t have to use Harvey there."),
    ]),
    ("JK Dobbins", ["dobbins", "j.k. dobbins"], [
        ("week2", "watch", "Favored as early-down grinder. Injury-prone; that’s the Harvey/Coleman dart."),
    ]),
    ("Keaton Mitchell", ["heaton mitchell", "katon"], [
        ("week2", "do", "Clear Chargers RB2 after Hampton’s 3-play drive. Real receiving usage (wheel + dump-offs). McDaniel wanted him. Stone-cold free, ~15th round. Fine to stack with Hampton."),
        ("week1", "watch", "Rested next to Hampton — they have plans. Specialized explosive role possible."),
    ]),
    ("Jacory Croskey-Merritt", ["jcm", "croskey", "merritt"], [
        ("camp", "do", "Prefer him over Rachaad White. Early-down/goal-line lean, cheap upside. Expect a split."),
        ("week1", "watch", "Messy Washington committee — don’t overthink ‘the guy.’"),
    ]),
    ("Rachaad White", ["rashad white", "rachaad"], [
        ("camp", "dont", "Inefficient, unexplosive. Daniels doesn’t check down a ton. Cheap enough to roster either, but take JCM if you pick one."),
    ]),
    ("Jaydon Blue", ["jaden blue", "jadon blue"], [
        ("week2", "watch", "Week 2: 17 snaps vs Malik Davis 14. Not a locked RB2. Still prefer Blue’s juice."),
        ("week1", "watch", "20 of 26 snaps with fake starters. Behind Tank/Lloyd as a cuff; committee even if Javonte sits."),
    ]),
    ("Malik Davis", ["malik davis"], [
        ("week2", "dont", "Positive buzz and a near-even split with Blue. Don’t treat Blue as the clear cuff."),
        ("week1", "dont", "Blue’s snap lead pushed him behind Blue."),
    ]),
    ("Emmett Johnson", ["emmet johnson", "emmit"], [
        ("week2", "watch", "Waters muddied vs DeMarcato. Still the well-rounded cuff they prefer; DeMarcato is a JAG specialist."),
        ("week1", "do", "Forced 10 missed tackles; Reid praised him. Clear Walker handcuff in deep leagues, last round."),
        ("rookies", "watch", "Walker’s carry backup; a specialist (Smith/DeMarcato) may keep passing downs."),
    ]),
    ("Brashard Smith", ["berchard"], [
        ("week2", "dont", "Not a real RB — returner/gadget. Wouldn’t play 60% if Walker went down."),
        ("week1", "dont", "Two drives after Walker, then Johnson’s show."),
    ]),
    ("Tank Bigsby", ["tank", "bigsby"], [
        ("week1", "do", "Every snap with Eagles ‘starters’ while Saquon rested. Priority handcuff in an elite offense. Ignore the ugly box score."),
    ]),
    ("MarShawn Lloyd", ["marshawn lloyd", "marshaun"], [
        ("week1", "do", "Every snap with Packers starters while Jacobs sat. If Jacobs misses time this is a weekly top-10 RB. ADP ~RB56, cheaper than Corum-type cuffs."),
    ]),
    ("Ray Davis", ["ray davis"], [
        ("week1", "watch", "Mixed in with Bills starters. If Cook goes down, Ty Johnson keeps passing downs — Davis is the ground game, not a three-down lock."),
    ]),
    ("Ty Johnson", ["tai johnson"], [
        ("week2", "watch", "Mystery lower body; videos of him hanging at practice. If it lingers, Cook’s receiving role explodes. Not a player to draft — a news item."),
        ("week1", "watch", "Out a few weeks; not overly concerning then."),
    ]),
    ("Tyler Allgeier", ["allgeier", "algier"], [
        ("week1", "dont", "40–45% 1B buzz was not backed up. Spell-back behind Love."),
        ("rookies", "watch", "Will nibble early downs/goal line while Love’s ankle heals."),
    ]),
    ("Kendre Miller", ["kendre"], [
        ("top50", "do", "18th on Nick’s board. Happy to take him at 18; may not last into the middle of the 2nd."),
    ]),
    ("Blake Corum", ["corum"], [
        ("top50", "watch", "Why Kyren is a fade at cost. Split drives last 10 games; paced 900+ rush yards over the second half."),
        ("week1", "watch", "The expensive handcuff market (~9th). Contrast for why Lloyd is a discount."),
    ]),
    ("Mike Washington", ["mike washington", "mikey dubs", "michael washington"], [
        ("week2", "dont", "Clear Jeanty RB2 and beat-reporter 1-2 punch talk, but they do not want the Raiders offense without Jeanty. Compiler: 18-for-62 hoping for a TD. Don’t treat him as a smash cuff."),
    ]),
    ("Jadarian Price", ["jadarian price"], [
        ("rookies", "watch", "Seahawks first-rounder. 5–6 turn is too much; 6–7 palatable. Charbonnet likely PUP then a committee. Won’t jump up for him."),
    ]),
    ("Nick Singleton", ["singleton"], [
        ("rookies", "watch", "Titans deeper stash. New staff has no allegiance to Pollard; could eat carries by week 10–12."),
    ]),
    ("TreVeyon Henderson", ["treveyon", "trayvon henderson"], [
        ("week2", "dont", "Nick: crazy that people spend the 4–5 turn on Henderson when Harvey is an 8th/9th with similar rookie production. Not a hard fade of the player — a price fade."),
        ("strategy", "watch", "Was his RB2 in a Gibbs mock and he wished he’d attacked RB2 harder. Waiver replacement is clearer at RB than WR."),
    ]),
    ("Nico Collins", ["nico"], [
        ("week2", "do", "Higgins ACL for the year. Only real WR competition gone. Bump; end of 2nd as WR1 if you went RB-RB. Condensed targets, maybe more 2-TE. Don’t draft the other Texans WRs except a late Noel dart."),
        ("strategy", "do", "Last guy in the WR tier at the 3.03 decision vs Jacobs — he took Nico."),
        ("top50", "take", "Alpha WR cluster."),
    ]),
    ("Jaylin Noel", ["jaylen noel", "nowell", "jaylen nowell"], [
        ("week2", "do", "Only Texans WR with meat on the bone after Higgins. Slot profile. Late dart. Hutchinson is never startable; Tank Dell unknown."),
    ]),
    ("Xavier Hutchinson", ["hutchinson"], [
        ("week2", "dont", "350-route compiler. Coaching staff trusts him; you never start him. Don’t draft."),
    ]),
    ("Tank Dell", ["dell"], [
        ("week2", "dont", "Wish they could say the same as Noel. Unknown explosion coming back. Not a redraft click."),
    ]),
    ("Jayden Higgins", ["jayden higgins"], [
        ("week2", "dont", "Torn ACL, out for 2026. Don’t draft."),
    ]),
    ("Malik Nabers", ["nabers", "neighbors"], [
        ("strategy", "do", "Prototype 2–3 turn WR. In the 1.01 Gibbs build you want this cluster at 28–29."),
        ("camp", "do", "Biggest camp move: ~42–44 overall → 22 (WR10). Week 1 now in play. Historic target hog. Take him over Rice/Pickens in that range."),
        ("top50", "do", "Camp reports 180 from a month prior. If healthy, WR2 or even WR1 after two RBs in the 3rd."),
    ]),
    ("A.J. Brown", ["aj brown"], [
        ("strategy", "do", "2–3 turn WR cluster. Hitting as top-5 WR would surprise no one; the RBs there would."),
        ("top50", "take", "Alpha WR group."),
    ]),
    ("Chris Olave", ["olave"], [
        ("strategy", "do", "Fine to move up at the turn after Jordyn Tyson’s injury. Ascending Saints offense."),
        ("top50", "do", "Very good player in an ascending offense ~33."),
    ]),
    ("Drake London", ["london"], [
        ("strategy", "take", "Nick took him 2.11 after Bijan. Slot-usage template he wants for Tet/Egbuka."),
        ("top50", "take", "Tier 5."),
    ]),
    ("Rashee Rice", ["rice"], [
        ("strategy", "do", "In the 2–3 turn WR cluster. Don’t pass Nabers for him if both are there."),
        ("camp", "watch", "Caps KC rookies. More fantasy than real life."),
        ("top50", "do", "Five spots above ADP; fair late-2nd price. Some screens may shift to Walker."),
    ]),
    ("George Pickens", ["pickens"], [
        ("strategy", "do", "In the WR value cluster."),
        ("camp", "watch", "Don’t pass Nabers in the Rice/Pickens range."),
    ]),
    ("DeVonta Smith", ["devonta", "devonte smith"], [
        ("strategy", "do", "2–3 turn WR. Stack with London/Nico/Nabers after an elite RB."),
        ("top50", "do", "Could be this year’s JSN with AJ Brown gone."),
        ("camp", "watch", "Early-season Eagles will run through Smith + Lemon."),
    ]),
    ("Tetairoa McMillan", ["tet", "mcmillan", "tedo"], [
        ("week2", "do", "Slot rate 15% last year → ~41% in this preseason sample. Path to ~140 targets / possible top-10 WR. Nick early–mid 4th (won’t reach on Bryce). Michael more aggressive. Coker is the late dart with him."),
        ("top50", "take", "Rank 40."),
    ]),
    ("Jaylen Coker", ["coker", "jalen coker", "jaylen coker"], [
        ("week2", "do", "On the field every snap with Tet. Easy late-round WR."),
    ]),
    ("Emeka Egbuka", ["egbuka", "ebuka"], [
        ("strategy", "watch", "Toe injury may let him fall mid/late 4th. Don’t see a huge drop-off from 3rd-round RBs to these WRs."),
        ("week1", "watch", "Toe sprain, no surgery. 51–49 Week 1 full go. Stay in the late-3rd/early-4th WR cluster."),
        ("top50", "do", "Top candidate to be this year’s JSN as Tampa WR1 if Zac Robinson moves him around."),
    ]),
    ("Mike Evans", ["evans"], [
        ("week2", "watch", "Quad re-aggravation. Nick 3/4 turn → 4/5 turn, still a round ahead of ADP (~pick 60). Beat reporter: precautionary, back right before the season. Buy at ADP, don’t treat as locked WR1."),
        ("camp", "do", "WR17, take in the 4th anywhere. ESPN ADP in the 80s is absurd. Pearsall gone, Shanahan, red-zone vacuum."),
        ("top50", "do", "23 spots above consensus. ADP slow to adjust to Pearsall out."),
    ]),
    ("De'Zhaun Stribling", ["stribling", "stribbling", "deshawn stribling", "deon"], [
        ("week2", "do", "5 targets on 7 routes, contested catch, near-TD. Nick ~96 overall, OK 8th/9th. Don’t go earlier than 8th. If he sits with starters in week 3, ADP explodes. Bet: better than Deebo, ramps to ~80% including slot."),
        ("rookies", "do", "The shot they want. Jennings reincarnated but more explosive. ~50% snaps early, 70–75% routes by week 6."),
        ("week1", "do", "15 of 16 routes, 8 targets with backups. Michael ahead of Deebo, still a 10th-round pick."),
        ("camp", "watch", "Free late stash, not a priority yet. Host ~WR49."),
    ]),
    ("Deebo Samuel", ["deebo", "dbo"], [
        ("week2", "watch", "They expect Deebo + Evans to start the year. Stribling’s bet is passing him."),
        ("camp", "watch", "One-year deal back to Shanahan. Host in the 50s. Could play 80% Week 1."),
        ("top50", "watch", "Will matter more than the industry says; still behind Evans as the alpha."),
    ]),
    ("Zay Flowers", ["flowers"], [
        ("top50", "dont", "Won’t pay WR11–14. Fine mid-to-late 3rd. Baltimore stays run-heavy; hasn’t cleared ~115–120 targets. Inside-the-10: 11 Flowers catches vs 71 Henry carries over two years."),
        ("camp", "watch", "The one Ravens WR who has a weekly role — which is why they won’t also buy Ja'Kobi Lane."),
    ]),
    ("Ladd McConkey", ["ladd", "lad mcconkey"], [
        ("week1", "do", "The one Chargers WR to spend capital on."),
        ("top50", "do", "Bounce-back in McDaniel’s offense with a healthier OL."),
        ("strategy", "do", "4th/5th round WR value pile (Burden, Waddle, Ladd, Garrett Wilson)."),
    ]),
    ("Tee Higgins", ["tee higgins"], [
        ("top50", "do", "High-floor. TD upside if Burrow has an MVP year."),
        ("strategy", "do", "Fell to 4.03 in a mock — WR value after the 2–3 turn."),
    ]),
    ("Luther Burden", ["burden", "luther burden iii", "burton"], [
        ("camp", "do", "Groin 3–4 weeks. Scoop the dip, don’t fade. Mid-5th instead of reaching ~44. Funnel: Burden / Rome / Loveland."),
        ("week1", "watch", "Jogging video is a good sign. Injury created a fairer price."),
        ("top50", "watch", "47 on his board; market may be end of 3rd so he never gets him. Would like mid/late 5th for Amon-Ra upside."),
        ("strategy", "watch", "Groin may drop him to mid/late 4th."),
    ]),
    ("Alec Pierce", ["pierce"], [
        ("camp", "dont", "Ankle, still not practicing. Not a true target-hog WR1. Only clickable if he falls to the 8/9 or 9/10 turn."),
    ]),
    ("Josh Downs", ["downs", "josh ds"], [
        ("week2", "do", "Keenan Allen muddies targets ~1–2 slots, not a fade. Still ~78–81 overall / WR30. Price is wrong. Grab a ton."),
        ("camp", "do", "Very in. If Pierce misses time he’s every-down. ADP multiple rounds too cheap vs Underdog."),
    ]),
    ("Keenan Allen", ["keenan"], [
        ("week2", "watch", "Colts one-year deal. Annoyance for Downs, not a reason to fade Downs entirely. Rotational WR, 66% routes last year."),
    ]),
    ("Terry McLaurin", ["mclaurin", "mclaren"], [
        ("camp", "dont", "Hard fade. Tunsil torn tricep; McLaurin lives on long-developing deep routes that need pocket time."),
        ("top50", "watch", "Just outside the top 50 at 51."),
    ]),
    ("Stefon Diggs", ["diggs"], [
        ("camp", "watch", "~pick 100. Chain-mover, capped by Daniels rushing and Chig underneath. Prefer second-year darts at that price."),
    ]),
    ("Parker Washington", ["parker wash"], [
        ("camp", "do", "Buying the camp hype. Liam Cohen told him he’ll play 11/12/13 and line up everywhere. Last year ~25% TPRR. Preseason snaps are the tell. Host has had him over BTJ since spring."),
        ("week1", "do", "Better use of Pollard money than a capped Titans RB2."),
        ("rookies", "do", "Example of ‘spend 5–6 turn capital on better offenses’ vs Carnell Tate."),
    ]),
    ("Brian Thomas Jr.", ["btj", "brian thomas"], [
        ("camp", "dont", "Guest fully flipped to Parker Washington. Still plays a lot, but the four-WR room cannibalizes. Downgrade vs last year’s process."),
    ]),
    ("Rome Odunze", ["odunze", "rome"], [
        ("camp", "watch", "Forgotten talented piece. Spike weeks yes, full-year WR1 no. Loveland + Burden change the room. ADP too high in home leagues."),
    ]),
    ("Matthew Golden", ["golden"], [
        ("week2", "watch", "Stribling lives in the Golden / Worthy / Lemon / Godwin cluster late 90s."),
        ("week1", "watch", "Outside/two-WR-set guy with Watson. Looked awful as a rookie; won’t fully fade the opportunity. Reed still ranked ahead by Michael."),
        ("camp", "do", "The type of 2nd-year dart they’d rather shoot on around pick 100 than Diggs."),
    ]),
    ("Jayden Reed", ["reed", "jaden reed"], [
        ("week1", "watch", "Slot-only in 11 personnel; Watson/Golden in two-WR sets. Nick will move him much closer to Golden if Golden plays 15–20% more snaps."),
    ]),
    ("Garrett Wilson", ["garrett wilson"], [
        ("strategy", "do", "4th/5th WR value pile."),
        ("top50", "dont", "Jets passing offense scares him. Prefers Breece as the Jets shot. Omar Cooper Jr. + Kenyon Sadiq add competition."),
    ]),
    ("Jaylen Waddle", ["waddle"], [
        ("strategy", "do", "4th-round WR value. Nick took him 4.11 after Bijan/London/Nabers."),
        ("top50", "watch", "Rank 46. Leg sleeve, now off. Injury news will move him."),
    ]),
    ("DJ Moore", ["dj moore"], [
        ("week1", "split", "Twisted ankle, not serious. Nick wants him mid-5th as Bills WR1. Michael will not draft him: sub-20% share, spread Bills attack (Shakir/Coleman/Palmer/Kincaid), run-first."),
        ("rookies", "do", "Example of better 5–6 turn offense than Carnell Tate."),
    ]),
    ("Jordyn Tyson", ["jordan tyson", "tyson"], [
        ("rookies", "dont", "His WR1 of the class, now a stay-away. 4th hamstring since Oct 2025; possible 6–8 weeks / PUP. Was 6th-round; now 9–10 if at all."),
        ("week1", "dont", "Nick outside top-45 WRs; wouldn’t take near the 5–6 turn. If he falls outside top 100, bench stash for the second half."),
    ]),
    ("Carnell Tate", ["tate", "cornell tate"], [
        ("rookies", "dont", "4th overall, Titans. 5–6 turn is too steep. Systemic passing-offense risk. Wan'Dale may lead targets. Prefer Parker Washington / DJ Moore / QBs in that range."),
    ]),
    ("Makai Lemon", ["lemon", "mai lemon"], [
        ("camp", "watch", "Hamstring has cost a ton of camp; may not start Week 1. Scoop ~pick 100 if ADP dips. Second-half play, not an early smash."),
        ("rookies", "do", "First-round capital, ~10th-round ADP. Bet the talent next to Golden types."),
    ]),
    ("Dontayvion Wicks", ["wicks"], [
        ("camp", "dont", "Could start in 2-WR sets while Lemon is behind. Drops on tape. Late best-ball only, not a managed-league priority."),
    ]),
    ("Ja'Kobi Lane", ["jakobi lane", "jacobe lane"], [
        ("camp", "dont", "Extreme camp hype. Lamar doesn’t sustain a WR2; Flowers occupies that. Fun last-round/dynasty, not a weekly starter."),
        ("rookies", "dont", "WR3 at best on the run-heaviest team. Flowers is the fine 3rd-round pick in that passing game."),
    ]),
    ("Denzel Boston", ["boston"], [
        ("camp", "watch", "Real camp hype, fringe R1 talent. Only late rookie they might stab. Browns QB mess + Fannin leading targets. 14th–16th round dart."),
        ("week1", "watch", "Played with starters as the X. Nick is a year early on a Watson X."),
        ("rookies", "watch", "Less PPR-fun than Concepcion."),
    ]),
    ("KC Concepcion", ["concepcion", "casey"], [
        ("week1", "do", "Entire first half with starters, schemed touches, TD. Monken will force-feed. Higher PPR floor than Boston. Overlaps Fannin."),
        ("rookies", "do", "Prefers him to Boston in full PPR. Dart; room lights up when they get a real QB."),
        ("camp", "watch", "Could be a featured WR, which is why neither Browns rookie is a reliable WR2 behind Fannin."),
    ]),
    ("Cyrus Allen", ["cyrus allen"], [
        ("camp", "dont", "Reid slow-plays rookies. Waiver wire to open the year. Last-round fun only."),
        ("rookies", "watch", "Reporters love him; hard to see the field over Rice/Worthy. May draft and drop."),
    ]),
    ("Xavier Worthy", ["worthy"], [
        ("camp", "dont", "Hasn’t put it together. Not enough leftover for Cyrus Allen either."),
    ]),
    ("Quentin Johnston", ["johnston", "q.j."], [
        ("week1", "dont", "Cannibalizes with Trey Harris in McDaniel 3-WR/FB sets. Don’t spend up."),
        ("top50", "dont", "Rank ~48. Hard to get excited about the situation."),
    ]),
    ("Trey Harris", ["trey harris", "tre harris"], [
        ("week1", "dont", "Locked WR3, but McDaniel WR3s are never full-time. May never eclipse 50–55% snaps. Avoid meaningful capital outside Ladd and Hampton."),
    ]),
    ("Caleb Douglas", ["douglas"], [
        ("rookies", "do", "Dolphins 3rd-rounder, 6'4\"/4.39. In 12 personnel with starters. Barren WR room — targets up for grabs. Fun late dart."),
    ]),
    ("Zachariah Branch", ["branch"], [
        ("rookies", "do", "Falcons 3rd-rounder. London then a bunch of nobodies. If he’s any good he should pass Dotson/Zaccheaus. Late upside shot."),
    ]),
    ("Wan'Dale Robinson", ["wandale", "wan dale"], [
        ("week2", "do", "PPR guy at the 8–9 turn in the strategy video."),
        ("rookies", "watch", "Nick thinks Daboll may feed him first in Tennessee — part of the Tate fade."),
    ]),
    ("Davante Adams", ["davante", "adams"], [
        ("top50", "watch", "Rank 44. Fading slightly as Puka’s running mate (age, weaker finish) is part of the Puka 1.02 case."),
    ]),
    ("Justin Jefferson", ["jefferson", "jj"], [
        ("top50", "take", "Core elite WR in the mid-tier cluster. No fade."),
    ]),
    ("CeeDee Lamb", ["ceedee", "lamb"], [
        ("top50", "take", "Tier-2 elite WR with Chase."),
    ]),
    ("Amon-Ra St. Brown", ["amon-ra", "arsb", "st. brown", "st brown"], [
        ("top50", "take", "Tier-3 WR1 with JSN."),
    ]),
    ("Jaxon Smith-Njigba", ["jsn", "smith-njigba", "njigba"], [
        ("top50", "take", "Tier-3 WR1. The breakout comp they want for Egbuka/DeVonta."),
    ]),
    ("Trey McBride", ["mcbride"], [
        ("strategy", "dont", "Don’t take him at the 2–3 turn from an early pick. TE heat map is perfect later: Warren/Loveland 4–5, LaPorta/Kraft 6–7, Kincaid even later."),
        ("top50", "take", "Closes tier 6. Elite TE — just not at your 28–29."),
    ]),
    ("Brock Bowers", ["bowers"], [
        ("strategy", "dont", "Will have a massive year. Still don’t spend 28–29 on him in 1TE. Same later-TE plan."),
        ("top50", "take", "Closes the Saquon tier. Elite, wrong pick window for 1.01."),
    ]),
    ("Tyler Warren", ["tyler warren"], [
        ("week2", "watch", "Something will keep him out a couple weeks / rest of preseason. Downs still the WR target."),
        ("strategy", "do", "Love him at the 4–5 turn. Set-and-forget TE1. In 1QB, if you take Warren in the 4th, wait on QB."),
        ("camp", "take", "Chain-mover with Downs if Pierce is limited."),
        ("top50", "do", "Could see ~130 targets with Pierce/Downs/Pittman noise. Vegas 74.5 rec. Drafting him in the 5th shouldn’t be a regret."),
    ]),
    ("Colston Loveland", ["loveland", "coulson"], [
        ("strategy", "do", "4–5 turn with Warren in casual leagues; best ball rooms push him up. Year-2 breakout."),
        ("camp", "do", "Sun the Bears offense orbits around. TE1 in range of outcomes."),
        ("top50", "take", "His TE3 at 43."),
    ]),
    ("Sam LaPorta", ["laporta"], [
        ("strategy", "do", "6–7 turn if Warren/Loveland are gone. Set-and-forget."),
        ("week1", "do", "Better use of Pollard capital."),
    ]),
    ("Tucker Kraft", ["kraft"], [
        ("strategy", "do", "Nick took him 6.11 and felt great. 4–7 is a great TE1 range."),
        ("week1", "do", "Full 11-on-11s four weeks out; maybe ~90% snaps out of the gate."),
    ]),
    ("Harold Fannin Jr.", ["fannin", "fanning", "harold fannin"], [
        ("week1", "do", "Nick’s preferred Browns passing-volume click now that Njoku is gone. 80–90 catches even with 3–4 TDs. Concepcion’s schemed work is the only hesitation."),
        ("camp", "do", "Leads the Browns in targets — why Boston/Concepcion aren’t weekly WR2s."),
    ]),
    ("Chig Okonkwo", ["chig", "okonquo", "okonkwo", "jiggy"], [
        ("week2", "do", "12 of 14 snaps first two drives — possible full-time role. Punt TE ~pick 140 / TE18. Pair with Ferguson/Barner. YAC monster."),
        ("camp", "do", "Really high; legitimate threat to Diggs’ underneath targets."),
    ]),
    ("George Kittle", ["kittle"], [
        ("camp", "dont", "Too old, Achilles too serious. Bank on Evans in the red zone instead."),
        ("top50", "watch", "Old / coming off serious injury — part of the Evans bump."),
    ]),
    ("Dalton Kincaid", ["kincaid"], [
        ("strategy", "watch", "If you miss Warren/Loveland/LaPorta/Kraft, stock Kincaid later. Don’t panic-reach TE."),
    ]),
    ("Oronde Gadsden II", ["gadsden", "gadson"], [
        ("week1", "dont", "Heavy stay-away. Insufferable blocker; they signed Kolar and Njoku. Won’t be on the field enough."),
    ]),
    ("Josh Allen", ["josh allen"], [
        ("strategy", "dont", "Don’t jump for him from an early pick in 1QB. If you take Allen in the 3rd, don’t also take TE in the 5th/6th. Wait for Purdy/Stafford in the 9th–10th."),
        ("top50", "take", "Stud every year — still not your 28th pick."),
    ]),
    ("Lamar Jackson", ["lamar"], [
        ("strategy", "dont", "Same as Allen. Don’t jump in 1QB from the early slot."),
        ("top50", "watch", "ADP ‘broken’ after a down (hamstring) year. Expects healthy Lamar. Baltimore still run-heavy for Flowers."),
    ]),
    ("Jayden Daniels", ["jaden daniels", "daniels"], [
        ("camp", "do", "Still targeting him in the post-Lamar QB tier / 8th round. Legs thesis survives Tunsil’s torn tricep."),
    ]),
    ("Jalen Hurts", ["hurts", "herz"], [
        ("camp", "do", "Could finish QB1 overall and is sitting 6th/7th next to Daniels — too cheap. Take-your-pick in that cluster."),
    ]),
    ("Brock Purdy", ["purdy"], [
        ("strategy", "do", "The wait-on-QB pick. Nick took him 10.11 in the Bijan mock. 1QB stream of 15–16 good ones later."),
    ]),
    ("Matthew Stafford", ["stafford"], [
        ("strategy", "do", "Same wait-on-QB bucket as Purdy in the 9th."),
    ]),
    ("Daniel Jones", ["daniel jones"], [
        ("camp", "watch", "Coming off Achilles. Don’t center Colts passing bets (Downs/Warren/Pierce) on him being great."),
    ]),
]

# Extra players not always in FFC under the same spelling
EXTRA_PLAYERS = [
    {"name": "De'Zhaun Stribling", "pos": "WR", "team": "SF", "adp": 96, "adpSlot": "7.12"},
    {"name": "Keaton Mitchell", "pos": "RB", "team": "LAC", "adp": 160, "adpSlot": "12.06"},
    {"name": "Chig Okonkwo", "pos": "TE", "team": "WAS", "adp": 140, "adpSlot": "10.14"},
    {"name": "Jaylin Noel", "pos": "WR", "team": "HOU", "adp": 180, "adpSlot": "13.12"},
    {"name": "Kalin Black", "pos": "RB", "team": "SF", "adp": 200, "adpSlot": "15.04"},
    {"name": "Jordan James", "pos": "RB", "team": "SF", "adp": 205, "adpSlot": "15.09"},
    {"name": "Jonah Coleman", "pos": "RB", "team": "DEN", "adp": 175, "adpSlot": "13.07"},
    {"name": "Caleb Douglas", "pos": "WR", "team": "MIA", "adp": 190, "adpSlot": "14.08"},
    {"name": "Zachariah Branch", "pos": "WR", "team": "ATL", "adp": 185, "adpSlot": "14.03"},
    {"name": "Ja'Kobi Lane", "pos": "WR", "team": "BAL", "adp": 195, "adpSlot": "14.13"},
    {"name": "Cyrus Allen", "pos": "WR", "team": "KC", "adp": 198, "adpSlot": "15.02"},
    {"name": "Mike Washington", "pos": "RB", "team": "LV", "adp": 128, "adpSlot": "10.02"},
    {"name": "Jacory Croskey-Merritt", "pos": "RB", "team": "WAS", "adp": 120, "adpSlot": "9.08"},
    {"name": "Emmett Johnson", "pos": "RB", "team": "KC", "adp": 170, "adpSlot": "13.02"},
    {"name": "MarShawn Lloyd", "pos": "RB", "team": "GB", "adp": 150, "adpSlot": "11.10"},
    {"name": "Tank Bigsby", "pos": "RB", "team": "PHI", "adp": 145, "adpSlot": "11.05"},
    {"name": "Makai Lemon", "pos": "WR", "team": "PHI", "adp": 100, "adpSlot": "8.02"},
    {"name": "Parker Washington", "pos": "WR", "team": "JAX", "adp": 90, "adpSlot": "7.06"},
    {"name": "Jaylen Coker", "pos": "WR", "team": "CAR", "adp": 155, "adpSlot": "12.01"},
    {"name": "KC Concepcion", "pos": "WR", "team": "CLE", "adp": 165, "adpSlot": "12.11"},
    {"name": "Harold Fannin Jr.", "pos": "TE", "team": "CLE", "adp": 88, "adpSlot": "7.04"},
    {"name": "Jordyn Tyson", "pos": "WR", "team": "NO", "adp": 100, "adpSlot": "8.02"},
    {"name": "Carnell Tate", "pos": "WR", "team": "TEN", "adp": 70, "adpSlot": "5.14"},
    {"name": "Jadarian Price", "pos": "RB", "team": "SEA", "adp": 85, "adpSlot": "7.01"},
    {"name": "Devin Singletary", "pos": "RB", "team": "NYG", "adp": 165, "adpSlot": "12.11"},
    {"name": "Brashard Smith", "pos": "RB", "team": "KC", "adp": 172, "adpSlot": "13.04"},
    {"name": "Kendre Miller", "pos": "RB", "team": "NO", "adp": 18, "adpSlot": "2.04"},
    {"name": "Nick Singleton", "pos": "RB", "team": "TEN", "adp": 188, "adpSlot": "14.06"},
    {"name": "Alvin Kamara", "pos": "RB", "team": "NO", "adp": 110, "adpSlot": "8.12"},
    {"name": "Najee Harris", "pos": "RB", "team": "NYG", "adp": 175, "adpSlot": "13.07"},
    {"name": "Tyrone Tracy", "pos": "RB", "team": "NYG", "adp": 130, "adpSlot": "10.04"},
    {"name": "Trey Harris", "pos": "WR", "team": "LAC", "adp": 135, "adpSlot": "10.09"},
    {"name": "Oronde Gadsden II", "pos": "TE", "team": "LAC", "adp": 160, "adpSlot": "12.06"},
]


def norm(s):
    s = s.lower()
    s = s.replace("’", "'").replace("`", "'")
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    s = re.sub(r"\b(jr|sr|iii|ii|iv)\b", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def last_first(s):
    parts = norm(s).split()
    if len(parts) >= 2:
        return parts[-1] + " " + parts[0]
    return norm(s)


# Build lookup from notes
note_index = {}  # norm name -> record
alias_to_canon = {}

for canon, aliases, entries in NOTES:
    rec = {"name": canon, "aliases": aliases, "entries": entries}
    keys = [norm(canon)] + [norm(a) for a in aliases]
    keys.append(last_first(canon))
    for k in keys:
        if k:
            alias_to_canon[k] = canon
    note_index[canon] = rec


def verdict_from(entries):
    if not entries:
        return "none"
    # newest first
    ranked = sorted(entries, key=lambda e: SOURCES[e[0]]["order"])
    stances = [e[1] for e in ranked]
    newest = stances[0]
    if newest in ("do", "dont", "watch", "take", "split"):
        # if newer watch but older do/dont, keep newest unless it's only a small update
        return newest
    return "none"


PICKS_14_1 = []
for rnd in range(1, 16):
    if rnd % 2 == 1:
        PICKS_14_1.append((rnd - 1) * 14 + 1)
    else:
        PICKS_14_1.append(rnd * 14)


def pick_window(adp):
    if adp is None:
        return None
    for i, pk in enumerate(PICKS_14_1):
        if abs(adp - pk) <= 5:
            rnd = i + 1
            return {
                "round": rnd,
                "pick": pk,
                "label": f"R{rnd} (pick {pk})",
            }
    return None


def match_notes(name):
    n = norm(name)
    lf = last_first(name)
    canon = alias_to_canon.get(n) or alias_to_canon.get(lf)
    return note_index.get(canon) if canon else None


def core_name(name):
    return norm(name)


def already_have(name, pos):
    n = core_name(name)
    nlast = n.split()[-1] if n else ""
    nfirst = n.split()[0] if n else ""
    for p in players:
        if p.get("pos") != pos:
            continue
        pn = core_name(p["name"])
        if pn == n or pn.startswith(n + " ") or n.startswith(pn + " "):
            return p
        parts = pn.split()
        if nlast and parts and parts[-1] == nlast:
            pfirst = parts[0]
            if pfirst[:3] == nfirst[:3] or {pfirst, nfirst} <= {"jalen", "jaylen", "john", "jon", "jonathan", "jonathon"}:
                return p
            if len(parts) >= 2 and nlast == parts[-1]:
                # extras: same last name + position is almost always a spelling variant
                return p
    return None


players = []
seen = set()

for p in ADP["players"]:
    rec = dict(p)
    nrec = match_notes(p["name"])
    notes = []
    if nrec:
        seen.add(nrec["name"])
        for src, stance, text in nrec["entries"]:
            notes.append({
                "src": src,
                "srcLabel": SOURCES[src]["label"],
                "order": SOURCES[src]["order"],
                "video": SOURCES[src]["id"],
                "stance": stance,
                "text": text,
            })
        notes.sort(key=lambda x: x["order"])
    rec["notes"] = notes
    rec["verdict"] = verdict_from([(n["src"], n["stance"]) for n in notes]) if notes else "none"
    rec["window"] = pick_window(rec.get("adp"))
    rec["hasNotes"] = bool(notes)
    players.append(rec)

# Collapse ESPN/FFC duplicates like Kenneth Walker / Kenneth Walker III
collapsed = []
for p in players:
    dup = None
    for q in collapsed:
        if q.get("pos") != p.get("pos"):
            continue
        pn, qn = core_name(p["name"]), core_name(q["name"])
        if pn == qn or pn.startswith(qn + " ") or qn.startswith(pn + " "):
            dup = q
            break
    if not dup:
        collapsed.append(p)
        continue
    # keep the one with a real FFC rank; merge notes
    keep, drop = (dup, p) if dup.get("adpRank") else (p, dup)
    if not keep.get("adpRank") and p.get("adpRank"):
        keep, drop = p, dup
    if drop.get("notes") and not keep.get("notes"):
        keep["notes"] = drop["notes"]
        keep["verdict"] = drop["verdict"]
        keep["hasNotes"] = drop["hasNotes"]
    if keep is p:
        collapsed = [x if x is not dup else p for x in collapsed]
players = collapsed

# Add extras not already present
for extra in EXTRA_PLAYERS:
    if already_have(extra["name"], extra["pos"]):
        continue
    nrec = match_notes(extra["name"])
    notes = []
    if nrec:
        seen.add(nrec["name"])
        for src, stance, text in nrec["entries"]:
            notes.append({
                "src": src,
                "srcLabel": SOURCES[src]["label"],
                "order": SOURCES[src]["order"],
                "video": SOURCES[src]["id"],
                "stance": stance,
                "text": text,
            })
        notes.sort(key=lambda x: x["order"])
    rec = {
        "id": extra["name"].lower().replace(" ", "").replace("'", "").replace(".", "") + "-" + extra["pos"],
        "name": extra["name"],
        "pos": extra["pos"],
        "team": extra["team"],
        "bye": None,
        "adp": extra["adp"],
        "adpSlot": extra.get("adpSlot"),
        "adpRank": None,
        "espnAdp": None,
        "espnRank": None,
        "notes": notes,
        "verdict": verdict_from([(n["src"], n["stance"]) for n in notes]) if notes else "none",
        "window": pick_window(extra["adp"]),
        "hasNotes": bool(notes),
        "approxAdp": True,
    }
    players.append(rec)

# Attach notes to extras that already exist in ADP (match by alias)
for p in players:
    if p["notes"]:
        continue
    nrec = match_notes(p["name"])
    if not nrec:
        continue
    notes = []
    for src, stance, text in nrec["entries"]:
        notes.append({
            "src": src,
            "srcLabel": SOURCES[src]["label"],
            "order": SOURCES[src]["order"],
            "video": SOURCES[src]["id"],
            "stance": stance,
            "text": text,
        })
    notes.sort(key=lambda x: x["order"])
    p["notes"] = notes
    p["verdict"] = verdict_from([(n["src"], n["stance"]) for n in notes])
    p["hasNotes"] = True
    seen.add(nrec["name"])

players.sort(key=lambda p: (p["adp"] if p["adp"] is not None else 999, p["name"]))

# Drop approx rows that duplicate a real ADP player; copy notes over.
real, approx = [], []
for p in players:
    (approx if p.get("approxAdp") else real).append(p)
kept_approx = []
for a in approx:
    hit = None
    for q in real:
        if q.get("pos") != a.get("pos"):
            continue
        if already_have.__wrapped__ if False else None:
            pass
        an, qn = core_name(a["name"]), core_name(q["name"])
        al, ql = an.split()[-1], qn.split()[-1]
        if an == qn or (al == ql and (an.split()[0][:3] == qn.split()[0][:3] or {an.split()[0], qn.split()[0]} & {"jalen", "jaylen"})):
            hit = q
            break
        # Tre' Harris / Trey Harris
        if al == ql and q.get("pos") == a.get("pos") and al in {"harris", "coker", "okonkwo", "fannin"}:
            hit = q
            break
    if hit:
        if a.get("notes") and not hit.get("notes"):
            hit["notes"] = a["notes"]
            hit["verdict"] = a["verdict"]
            hit["hasNotes"] = a["hasNotes"]
            seen.add(a["name"])
        continue
    kept_approx.append(a)
players = real + kept_approx
players.sort(key=lambda p: (p["adp"] if p["adp"] is not None else 999, p["name"]))

unmatched = [n[0] for n in NOTES if n[0] not in seen]
print("unmatched notes", unmatched)

# Per-turn click lists for 14-team · 1.01 hero-RB build (4–6 names each).
# Situational notes (e.g. mock-board TE timing) live here — not in the Plan cheat sheet.
TURN_TARGETS = [
    {
        "summary": "Hero RB. Nick’s 1.01 is Gibbs — not Chase/Puka in a 2-WR league.",
        "players": ["Jahmyr Gibbs", "Bijan Robinson", "Christian McCaffrey", "Jonathan Taylor"],
        "pass": [],
    },
    {
        "summary": "Two WRs (or one WR + falling RB2). WR firepower turn.",
        "players": ["Malik Nabers", "Chris Olave", "Nico Collins", "A.J. Brown", "DeVonta Smith", "George Pickens"],
        "pass": ["Josh Jacobs"],
    },
    {
        "summary": "TE + RB2 after Gibbs + 2 WRs. Mock check: Warren often gone ~4.12 — LaPorta is the next TE up.",
        "players": ["Sam LaPorta", "Tucker Kraft", "Travis Etienne Jr.", "Cam Skattebo", "Tyler Warren", "Colston Loveland"],
        "pass": ["Terry McLaurin", "DJ Moore", "Jameson Williams", "Jalen Hurts"],
    },
    {
        "summary": "Flex depth, value QB, TE if you waited, Skattebo if he slid.",
        "players": ["Josh Downs", "Sam LaPorta", "Tucker Kraft", "Jayden Daniels", "Jalen Hurts", "Brock Purdy"],
        "pass": [],
    },
    {
        "summary": "Mid-round value WRs and streamers.",
        "players": ["De'Zhaun Stribling", "Parker Washington", "Tetairoa McMillan", "Breece Hall", "Matthew Stafford", "Cam Skattebo"],
        "pass": [],
    },
    {
        "summary": "Bench upside and TE/QB depth.",
        "players": ["Dalton Kincaid", "Chig Okonkwo", "Jalen Coker", "Keaton Mitchell", "Tank Bigsby", "MarShawn Lloyd"],
        "pass": [],
    },
    {
        "summary": "Handcuffs and late rookie darts.",
        "players": ["Jonathon Brooks", "Keaton Mitchell", "Tank Bigsby", "MarShawn Lloyd", "Chig Okonkwo", "Jalen Coker"],
        "pass": [],
    },
    {
        "summary": "Kicker and DST only — never earlier.",
        "players": [],
        "pass": [],
        "note": "Only K and DST in your last two picks.",
    },
]


def _player_lookup(players):
    by_name = {}
    for p in players:
        by_name[p["name"].lower()] = p
    return by_name


def _resolve_target_names(names, lookup):
    out = []
    for name in names:
        p = lookup.get(name.lower())
        if p:
            out.append(p["id"])
        else:
            print("target player not found:", name)
    return out


player_lookup = _player_lookup(players)
target_turns = []
for t in TURN_TARGETS:
    target_turns.append({
        "summary": t["summary"],
        "playerIds": _resolve_target_names(t["players"], player_lookup),
        "passIds": _resolve_target_names(t.get("pass", []), player_lookup),
        "note": t.get("note"),
    })

out = {
    "league": {
        "teams": 14,
        "pick": 1,
        "snake": True,
        "roster": "1 QB, 2 RB, 2 WR, FLEX, TE, K, DST",
        "picks": PICKS_14_1,
        "windows": [
            {"round": 1, "picks": [1], "label": "1.01"},
            {"round": "2–3", "picks": [28, 29], "label": "2.14 & 3.01 (you pick twice)"},
            {"round": "4–5", "picks": [56, 57], "label": "4.14 & 5.01"},
            {"round": "6–7", "picks": [84, 85], "label": "6.14 & 7.01"},
            {"round": "8–9", "picks": [112, 113], "label": "8.14 & 9.01"},
            {"round": "10–11", "picks": [140, 141], "label": "10.14 & 11.01"},
            {"round": "12–13", "picks": [168, 169], "label": "12.14 & 13.01"},
            {"round": "14–15", "picks": [196, 197], "label": "14.14 & 15.01"},
        ],
    },
    "adp": {
        "primary": "Fantasy Football Calculator 14-team PPR",
        "range": "Aug 17–24, 2026",
        "drafts": ADP["ffcMeta"]["total_drafts"],
        "espn": "ESPN PPR ADP overlay where the name matched",
        "note": "Players marked approxAdp are BDGE rank/ADP mentions, not FFC.",
    },
    "videos": [
        {"id": "3PL4i_fy3NU", "title": "Preseason Games Changed Our Draft Rankings, Once Again.", "key": "week2", "when": "Newest — week 2 recap"},
        {"id": "hIQIkhGlrww", "title": "The #1 Draft Strategy in Fantasy Football", "key": "strategy", "when": "Early picks 1–4"},
        {"id": "n9kJSeO4naM", "title": "Look Like a Genius by Drafting These Rookies", "key": "rookies", "when": "Rookies"},
        {"id": "JDNJJO6ituM", "title": "Preseason Games Changed Our Draft Rankings, Again.", "key": "week1", "when": "Week 1 recap"},
        {"id": "ciw9TnF4vWM", "title": "Big Training Camp Ranking Changes to Know Before You Draft", "key": "camp", "when": "Camp changes"},
        {"id": "LL6cuiAP8lc", "title": "My Official Top 50 Rankings & Tiers", "key": "top50", "when": "Oldest of this set — top 50"},
    ],
    "players": players,
    "targets": {
        "profile": "14-team · 1.01 · hero RB + 2 WR",
        "turns": target_turns,
    },
}

Path(ROOT / "players.json").write_text(json.dumps(out, indent=2))
print("wrote", len(players), "players,", sum(1 for p in players if p["hasNotes"]), "with notes")
print("verdicts", {v: sum(1 for p in players if p["verdict"] == v) for v in ("do", "dont", "take", "watch", "split", "none")})
