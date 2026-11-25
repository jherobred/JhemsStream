// The stream screens for the Ready Player SITE finals, by scene, with the words each one shows.
// The same list feeds the PNG/video export; web/site.js builds the OBS scenes from matching params.
const SCHEDULE = "3:30 PM~Mobile Legends · Match 15|4:00 PM~Valorant · Championship Finals|7:00 PM~Mobile Legends · Championship Finals";
export const SCREENS = [
  { id: "01_Starting_Soon", q: { kind: "title", kicker: "Ready Player SITE · Esports Finals", title: "Starting soon", sub: "Grab a seat. The finals start shortly.", timer: "until", until: "15:30", lines: SCHEDULE } },
  { id: "02_Welcome_Finals_Day", q: { kind: "title", layout: "center", kicker: "Society of Information Technology Enthusiasts", title: "Esports Finals", sub: "Three matches. Two crowns." } },
  { id: "03_ML_M15_Up_Next", q: { kind: "vs", game: "Mobile Legends", label: "Up next · Match 15 · Lower Bracket Final", a: "Gxt", b: "GHETTOBOYS", sub: "Winner meets Esmiring Hi in the Grand Finals" } },
  { id: "04_ML_M15_Casters", q: { kind: "casters", game: "Mobile Legends", n1: "Jay Gervacio", n2: "Charles Bagus" } },
  { id: "08_ML_M15_Gxt_Advances", q: { kind: "advance", game: "Mobile Legends", label: "Match 15", team: "Gxt", sub: "Advances to the Grand Finals" } },
  { id: "09_ML_M15_GHETTOBOYS_Advances", q: { kind: "advance", game: "Mobile Legends", label: "Match 15", team: "GHETTOBOYS", sub: "Advances to the Grand Finals" } },
  { id: "10_VAL_Finals_Up_Next", q: { kind: "vs", game: "Valorant", label: "Up next · Match 22 · Championship Finals", a: "ITeletubbies", b: "Stick-O", sub: "Best of three for the Valorant crown" } },
  { id: "11_VAL_Finals_Casters", q: { kind: "casters", game: "Valorant", n1: "Leoj Zamora", n2: "Abe Policarpio" } },
  { id: "15_VAL_Tactical_Pause", q: { kind: "title", game: "Valorant", kicker: "Valorant · Match 22", title: "Tactical pause", sub: "The match resumes shortly." } },
  { id: "18_ML_Finals_Up_Next", q: { kind: "vs", game: "Mobile Legends", label: "Up next · Match 16 · Championship Finals", a: "Esmiring Hi", b: "Winner of Match 15", sub: "One series for the Mobile Legends crown" } },
  { id: "19_ML_Finals_Casters", q: { kind: "casters", game: "Mobile Legends", n1: "Jay Gervacio", n2: "Charles Bagus" } },
  { id: "26_VAL_Final_Standings", q: { kind: "standings", game: "Valorant", title: "Final standings", l1: "Champions", t1: "TBA", l2: "1st Runner-up", t2: "TBA", l3: "2nd Runner-up", t3: "TBA" } },
  { id: "27_ML_Final_Standings", q: { kind: "standings", game: "Mobile Legends", title: "Final standings", l1: "Champions", t1: "TBA", l2: "1st Runner-up", t2: "TBA", l3: "2nd Runner-up", t3: "TBA", l4: "3rd Runner-up", t4: "TBA", l5: "4th Runner-up", t5: "TBA" } },
  { id: "29_Be_Right_Back", q: { kind: "title", kicker: "Ready Player SITE · Esports Finals", title: "Be right back", sub: "Stay tuned." } },
  { id: "30_Technical_Difficulties", q: { kind: "title", kicker: "Ready Player SITE · Esports Finals", title: "Technical difficulties", sub: "We're fixing it. Please stand by." } },
  { id: "31_Thanks_For_Watching", q: { kind: "title", layout: "center", kicker: "Ready Player SITE · Esports Finals", title: "Thanks for watching", sub: "Congratulations to every team." } },
];
