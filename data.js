/* F1 Predictor 2026 - static data: calendar, teams, drivers */
'use strict';

const TEAMS = {
  mclaren:       { id: 'mclaren',       name: 'McLaren',       color: '#FF8000', accent: '#9A99B1', logo: 'images/teams/mclaren.webp',       base: 1650 },
  ferrari:       { id: 'ferrari',       name: 'Ferrari',       color: '#E8002D', accent: '#FFD700', logo: 'images/teams/ferrari.webp',       base: 1600 },
  redbullracing: { id: 'redbullracing', name: 'Red Bull',      color: '#3671C6', accent: '#1E1F26', logo: 'images/teams/redbullracing.webp', base: 1590 },
  mercedes:      { id: 'mercedes',      name: 'Mercedes',      color: '#27F4D2', accent: '#00A19B', logo: 'images/teams/mercedes.webp',      base: 1570 },
  williams:      { id: 'williams',      name: 'Williams',      color: '#64C4FF', accent: '#0B1B2B', logo: 'images/teams/williams.webp',      base: 1500 },
  astonmartin:   { id: 'astonmartin',   name: 'Aston Martin',  color: '#229971', accent: '#F1E9DB', logo: 'images/teams/astonmartin.webp',   base: 1500 },
  alpine:        { id: 'alpine',        name: 'Alpine',        color: '#FF87BC', accent: '#0093CC', logo: 'images/teams/alpine.webp',        base: 1490 },
  racingbulls:   { id: 'racingbulls',   name: 'Racing Bulls',  color: '#6692FF', accent: '#24344D', logo: 'images/teams/racingbulls.webp',   base: 1490 },
  haasf1team:    { id: 'haasf1team',    name: 'Haas',          color: '#B6BABD', accent: '#D10E2C', logo: 'images/teams/haasf1team.webp',    base: 1485 },
  audi:          { id: 'audi',          name: 'Audi',          color: '#D50032', accent: '#000000', logo: 'images/teams/audi.webp',          base: 1490 },
  cadillac:      { id: 'cadillac',      name: 'Cadillac',      color: '#A0AAB2', accent: '#C8102E', logo: 'images/teams/cadillac.webp',      base: 1480 }
};

const DRIVERS = [
  { id: 'verstappen', name: 'Max Verstappen',    short: 'VER', num: 1,  team: 'redbullracing', country: 'NL', flag: '🇳🇱', img: 'images/drivers/verstappen.webp', rating: 1680 },
  { id: 'norris',     name: 'Lando Norris',      short: 'NOR', num: 4,  team: 'mclaren',       country: 'GB', flag: '🇬🇧', img: 'images/drivers/norris.webp',     rating: 1650 },
  { id: 'piastri',    name: 'Oscar Piastri',     short: 'PIA', num: 81, team: 'mclaren',       country: 'AU', flag: '🇦🇺', img: 'images/drivers/piastri.webp',    rating: 1630 },
  { id: 'leclerc',    name: 'Charles Leclerc',   short: 'LEC', num: 16, team: 'ferrari',       country: 'MC', flag: '🇲🇨', img: 'images/drivers/leclerc.webp',    rating: 1620 },
  { id: 'russell',    name: 'George Russell',    short: 'RUS', num: 63, team: 'mercedes',      country: 'GB', flag: '🇬🇧', img: 'images/drivers/russell.webp',    rating: 1590 },
  { id: 'hamilton',   name: 'Lewis Hamilton',    short: 'HAM', num: 44, team: 'ferrari',       country: 'GB', flag: '🇬🇧', img: 'images/drivers/hamilton.webp',   rating: 1580 },
  { id: 'antonelli',  name: 'Kimi Antonelli',    short: 'ANT', num: 12, team: 'mercedes',      country: 'IT', flag: '🇮🇹', img: 'images/drivers/antonelli.webp',  rating: 1560 },
  { id: 'sainz',      name: 'Carlos Sainz',      short: 'SAI', num: 55, team: 'williams',      country: 'ES', flag: '🇪🇸', img: 'images/drivers/sainz.webp',      rating: 1550 },
  { id: 'alonso',     name: 'Fernando Alonso',   short: 'ALO', num: 14, team: 'astonmartin',   country: 'ES', flag: '🇪🇸', img: 'images/drivers/alonso.webp',     rating: 1540 },
  { id: 'gasly',      name: 'Pierre Gasly',      short: 'GAS', num: 10, team: 'alpine',        country: 'FR', flag: '🇫🇷', img: 'images/drivers/gasly.webp',      rating: 1530 },
  { id: 'albon',      name: 'Alex Albon',        short: 'ALB', num: 23, team: 'williams',      country: 'TH', flag: '🇹🇭', img: 'images/drivers/albon.webp',      rating: 1520 },
  { id: 'lawson',     name: 'Liam Lawson',       short: 'LAW', num: 30, team: 'racingbulls',   country: 'NZ', flag: '🇳🇿', img: 'images/drivers/lawson.webp',     rating: 1510 },
  { id: 'hulkenberg', name: 'Nico Hulkenberg',   short: 'HUL', num: 27, team: 'audi',          country: 'DE', flag: '🇩🇪', img: 'images/drivers/hulkenberg.webp', rating: 1500 },
  { id: 'perez',      name: 'Sergio Perez',      short: 'PER', num: 11, team: 'cadillac',      country: 'MX', flag: '🇲🇽', img: 'images/drivers/perez.webp',      rating: 1500 },
  { id: 'colapinto',  name: 'Franco Colapinto',  short: 'COL', num: 43, team: 'alpine',        country: 'AR', flag: '🇦🇷', img: 'images/drivers/colapinto.webp',  rating: 1500 },
  { id: 'hadjar',     name: 'Isack Hadjar',      short: 'HAD', num: 6,  team: 'redbullracing', country: 'FR', flag: '🇫🇷', img: 'images/drivers/hadjar.webp',     rating: 1500 },
  { id: 'bottas',     name: 'Valtteri Bottas',   short: 'BOT', num: 77, team: 'cadillac',      country: 'FI', flag: '🇫🇮', img: 'images/drivers/bottas.webp',     rating: 1495 },
  { id: 'ocon',       name: 'Esteban Ocon',      short: 'OCO', num: 31, team: 'haasf1team',    country: 'FR', flag: '🇫🇷', img: 'images/drivers/ocon.webp',      rating: 1505 },
  { id: 'bearman',    name: 'Oliver Bearman',    short: 'BEA', num: 87, team: 'haasf1team',    country: 'GB', flag: '🇬🇧', img: 'images/drivers/bearman.webp',    rating: 1495 },
  { id: 'bortoleto',  name: 'Gabriel Bortoleto', short: 'BOR', num: 5,  team: 'audi',          country: 'BR', flag: '🇧🇷', img: 'images/drivers/bortoleto.webp',  rating: 1495 },
  { id: 'lindblad',   name: 'Arvid Lindblad',    short: 'LIN', num: 7,  team: 'racingbulls',   country: 'GB', flag: '🇬🇧', img: 'images/drivers/lindblad.webp',   rating: 1490 },
  { id: 'stroll',     name: 'Lance Stroll',      short: 'STR', num: 18, team: 'astonmartin',   country: 'CA', flag: '🇨🇦', img: 'images/drivers/stroll.webp',     rating: 1480 }
];

/* Home-race bonus: which drivers get a boost at which race */
const HOME_DRIVERS = {
  australia:   ['piastri'],
  britain:     ['norris', 'hamilton', 'russell', 'bearman', 'lindblad'],
  netherlands: ['verstappen'],
  monaco:      ['leclerc'],
  catalunya:   ['alonso', 'sainz'],
  madrid:      ['alonso', 'sainz'],
  mexico:      ['perez'],
  monza:       ['antonelli'],
  brazil:      ['bortoleto']
};

const RACES = [
  { id: 'australia',   round: 1,  name: 'Australian GP',          track: 'Melbourne',            country: 'Australia',      flag: '🇦🇺', date: '2026-03-08', sprint: false, type: 'street'    },
  { id: 'china',       round: 2,  name: 'Chinese GP',             track: 'Shanghai',             country: 'China',          flag: '🇨🇳', date: '2026-03-15', sprint: true,  type: 'permanent' },
  { id: 'japan',       round: 3,  name: 'Japanese GP',            track: 'Suzuka',               country: 'Japan',          flag: '🇯🇵', date: '2026-03-29', sprint: false, type: 'permanent' },
  { id: 'bahrain',     round: 4,  name: 'Bahrain GP',             track: 'Sakhir',               country: 'Bahrain',        flag: '🇧🇭', date: '2026-04-12', sprint: false, type: 'permanent' },
  { id: 'saudi',       round: 5,  name: 'Saudi Arabian GP',       track: 'Jeddah',               country: 'Saudi Arabia',   flag: '🇸🇦', date: '2026-04-19', sprint: false, type: 'street'    },
  { id: 'miami',       round: 6,  name: 'Miami GP',               track: 'Miami',                country: 'USA',            flag: '🇺🇸', date: '2026-05-03', sprint: true,  type: 'street'    },
  { id: 'canada',      round: 7,  name: 'Canadian GP',            track: 'Montreal',             country: 'Canada',         flag: '🇨🇦', date: '2026-05-24', sprint: true,  type: 'street'    },
  { id: 'monaco',      round: 8,  name: 'Monaco GP',              track: 'Monaco',               country: 'Monaco',         flag: '🇲🇨', date: '2026-06-07', sprint: false, type: 'street'    },
  { id: 'catalunya',   round: 9,  name: 'Barcelona-Catalunya GP', track: 'Barcelona',            country: 'Spain',          flag: '🇪🇸', date: '2026-06-14', sprint: false, type: 'permanent' },
  { id: 'austria',     round: 10, name: 'Austrian GP',            track: 'Spielberg',            country: 'Austria',        flag: '🇦🇹', date: '2026-06-28', sprint: false, type: 'permanent' },
  { id: 'britain',     round: 11, name: 'British GP',             track: 'Silverstone',          country: 'UK',             flag: '🇬🇧', date: '2026-07-05', sprint: true,  type: 'permanent' },
  { id: 'belgium',     round: 12, name: 'Belgian GP',             track: 'Spa-Francorchamps',    country: 'Belgium',        flag: '🇧🇪', date: '2026-07-19', sprint: false, type: 'permanent' },
  { id: 'hungary',     round: 13, name: 'Hungarian GP',           track: 'Budapest',             country: 'Hungary',        flag: '🇭🇺', date: '2026-07-26', sprint: false, type: 'permanent' },
  { id: 'netherlands', round: 14, name: 'Dutch GP',               track: 'Zandvoort',            country: 'Netherlands',    flag: '🇳🇱', date: '2026-08-23', sprint: true,  type: 'permanent' },
  { id: 'monza',       round: 15, name: 'Italian GP',             track: 'Monza',                country: 'Italy',          flag: '🇮🇹', date: '2026-09-06', sprint: false, type: 'permanent' },
  { id: 'madrid',      round: 16, name: 'Spanish GP',             track: 'Madrid (Madring)',     country: 'Spain',          flag: '🇪🇸', date: '2026-09-13', sprint: false, type: 'street'    },
  { id: 'azerbaijan',  round: 17, name: 'Azerbaijan GP',          track: 'Baku',                 country: 'Azerbaijan',     flag: '🇦🇿', date: '2026-09-26', sprint: false, type: 'street'    },
  { id: 'singapore',   round: 18, name: 'Singapore GP',           track: 'Marina Bay',           country: 'Singapore',      flag: '🇸🇬', date: '2026-10-11', sprint: true,  type: 'street'    },
  { id: 'austin',      round: 19, name: 'US GP',                  track: 'Austin (COTA)',        country: 'USA',            flag: '🇺🇸', date: '2026-10-25', sprint: false, type: 'permanent' },
  { id: 'mexico',      round: 20, name: 'Mexico City GP',         track: 'Hermanos Rodríguez',   country: 'Mexico',         flag: '🇲🇽', date: '2026-11-01', sprint: false, type: 'permanent' },
  { id: 'brazil',      round: 21, name: 'Sao Paulo GP',           track: 'Interlagos',           country: 'Brazil',         flag: '🇧🇷', date: '2026-11-08', sprint: false, type: 'permanent' },
  { id: 'vegas',       round: 22, name: 'Las Vegas GP',           track: 'Las Vegas Strip',      country: 'USA',            flag: '🇺🇸', date: '2026-11-21', sprint: false, type: 'street'    },
  { id: 'qatar',       round: 23, name: 'Qatar GP',               track: 'Lusail',               country: 'Qatar',          flag: '🇶🇦', date: '2026-11-29', sprint: false, type: 'permanent' },
  { id: 'abudhabi',    round: 24, name: 'Abu Dhabi GP',           track: 'Yas Marina',           country: 'UAE',            flag: '🇦🇪', date: '2026-12-06', sprint: false, type: 'permanent' }
];

const SPRINT_RACES = RACES.filter(r => r.sprint).map(r => r.id);

/* F1 points systems */
const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

const GRID = DRIVERS.length; // 22 drivers

const SESSIONS = {
  sq:      { id: 'sq',      label: 'Sprint Quali',  short: 'SQ',    color: '#7b5bd6', max: GRID },
  sprint:  { id: 'sprint',  label: 'Sprint Race',   short: 'SP',    color: '#d65b9a', max: GRID },
  quali:   { id: 'quali',   label: 'Qualifying',    short: 'Q',     color: '#5ba8d6', max: GRID },
  race:    { id: 'race',    label: 'Grand Prix',    short: 'R',     color: '#d6a25b', max: GRID }
};

const WEATHER = [
  { id: 'dry',          label: 'Dry',           effect: 0   },
  { id: 'changeable',   label: 'Changeable',    effect: 0.5 },
  { id: 'wet',          label: 'Wet',           effect: 1.2 },
  { id: 'chaos',        label: 'Chaos / Mixed', effect: 2.0 }
];

function driverById(id) { return DRIVERS.find(d => d.id === id); }
function teamById(id) { return TEAMS[id]; }
function raceById(id) { return RACES.find(r => r.id === id); }
function raceIndex(id) { return RACES.findIndex(r => r.id === id); }
