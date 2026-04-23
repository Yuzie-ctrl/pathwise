import { ImageSourcePropType } from 'react-native';

export interface MallFloor {
  /** Integer floor number (1-based). */
  number: number;
  label: string;
  image: ImageSourcePropType | null;
}

export interface Mall {
  id: string;
  name: string;
  /** Map coordinate for the marker. */
  latitude: number;
  longitude: number;
  /** Floors. Malls without map imagery still have at least one placeholder floor. */
  floors: MallFloor[];
  /** Known stores / tenants for autocomplete. Filled per-mall. */
  stores?: string[];
}

// Tallinn malls — coordinates are approximate (OSM-derived).
// Only T1 currently has real floor-plan imagery; other malls get placeholder
// floors (gray background with "Карта появится скоро") until future imports.
export const MALLS: Mall[] = [
  {
    id: 't1',
    name: 'T1 Mall of Tallinn',
    latitude: 59.4244,
    longitude: 24.7922,
    floors: [
      {
        number: 1,
        label: '1. korrus',
        image: require('@/assets/malls/t1_floor1.png'),
      },
      {
        number: 2,
        label: '2. korrus',
        image: require('@/assets/malls/t1_floor2.png'),
      },
      {
        number: 3,
        label: '3. korrus',
        image: require('@/assets/malls/t1_floor3.png'),
      },
      {
        number: 4,
        label: '4. korrus',
        image: require('@/assets/malls/t1_floor4.png'),
      },
    ],
    stores: [
      'Rimi Hypermarket', 'Apollo Kino', 'Super Skypark', 'Apollo Raamatud',
      'H&M', 'Reserved', 'New Yorker', 'Pull & Bear', 'Bershka',
      'Stradivarius', 'Lindex', 'Monton', 'KappAhl', 'Jack & Jones', 'Only',
      'Vero Moda', 'Calzedonia', 'Tommy Hilfiger', 'Nike', 'Adidas', 'Puma',
      'Sportland', 'Euronics', 'Telia', 'Elisa', 'Tele2', 'R-Kiosk',
      'Swedbank', 'SEB', 'LHV', 'Benu Apteek', 'Apotheka', 'Douglas',
      'Yves Rocher', 'Rituals', 'Pandora', 'Swarovski', 'McDonald\u2019s',
      'KFC', 'Burger King', 'Hesburger', 'Subway', 'Starbucks', 'Caffeine',
      'Vapiano',
    ],
  },
  {
    id: 'ulemiste',
    name: 'Ülemiste Keskus',
    latitude: 59.4217,
    longitude: 24.7944,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
      { number: 3, label: '3 этаж', image: null },
    ],
    stores: [
      'Prisma', 'Apollo Kino', 'Zara', 'Mango', 'H&M', 'Reserved', 'New Yorker',
      'Bershka', 'Pull & Bear', 'Stradivarius', 'Lindex', 'Tommy Hilfiger',
      'Calvin Klein', 'Sportland', 'Nike', 'Adidas', 'Euronics', 'Apple',
      'Telia', 'Elisa', 'Douglas', 'Yves Rocher', 'Rituals', 'Pandora',
      'Swedbank', 'SEB', 'McDonald\u2019s', 'Hesburger', 'Starbucks', 'Vapiano',
    ],
  },
  {
    id: 'viru',
    name: 'Viru Keskus',
    latitude: 59.4366,
    longitude: 24.7533,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
      { number: 3, label: '3 этаж', image: null },
      { number: 4, label: '4 этаж', image: null },
    ],
    stores: [
      'Rimi', 'Rahva Raamat', 'H&M', 'Zara', 'Mango', 'Lindex', 'Reserved',
      'Monton', 'Tommy Hilfiger', 'Calvin Klein', 'Apollo', 'Douglas',
      'Rituals', 'Pandora', 'Swarovski', 'Ideal', 'Swedbank', 'SEB',
      'McDonald\u2019s', 'KFC', 'Caffeine', 'Starbucks',
    ],
  },
  {
    id: 'kristiine',
    name: 'Kristiine Keskus',
    latitude: 59.4266,
    longitude: 24.727,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
    ],
    stores: [
      'Selver', 'H&M', 'Reserved', 'New Yorker', 'Lindex', 'Stockmann',
      'Jack & Jones', 'Only', 'Monton', 'Sportland', 'Euronics', 'Apollo Kino',
      'R-Kiosk', 'Benu Apteek', 'Hesburger', 'Subway',
    ],
  },
  {
    id: 'mustika',
    name: 'Mustika Keskus',
    latitude: 59.4017,
    longitude: 24.6699,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
    ],
    stores: [
      'Maxima XXX', 'KappAhl', 'Lindex', 'Sportland', 'Euronics', 'Jysk',
      'R-Kiosk', 'Apotheka', 'Hesburger',
    ],
  },
  {
    id: 'mustamae',
    name: 'Mustamäe Keskus',
    latitude: 59.4144,
    longitude: 24.6834,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
    ],
    stores: [
      'Rimi', 'Coop', 'New Yorker', 'Lindex', 'Sportland', 'Benu Apteek',
      'R-Kiosk', 'Swedbank', 'Hesburger',
    ],
  },
  {
    id: 'nautica',
    name: 'Nautica',
    latitude: 59.4428,
    longitude: 24.7398,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
    ],
    stores: [
      'Rimi', 'Sportmaster', 'KappAhl', 'R-Kiosk', 'SEB', 'Apollo Raamatud',
      'Subway',
    ],
  },
  {
    id: 'hobujaama',
    name: 'Hobujaama',
    latitude: 59.4352,
    longitude: 24.7607,
    floors: [{ number: 1, label: '1 этаж', image: null }],
    stores: ['Selver', 'R-Kiosk', 'Caffeine', 'Apotheka'],
  },
  {
    id: 'lasnamae',
    name: 'Lasnamäe Centrum',
    latitude: 59.4372,
    longitude: 24.8385,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
    ],
    stores: [
      'Prisma', 'Apollo Kino', 'Lindex', 'Reserved', 'New Yorker', 'Sportland',
      'Euronics', 'Benu Apteek', 'Hesburger',
    ],
  },
  {
    id: 'umera',
    name: 'Ümera Keskus',
    latitude: 59.4407,
    longitude: 24.8522,
    floors: [{ number: 1, label: '1 этаж', image: null }],
    stores: ['Rimi', 'R-Kiosk', 'Apotheka', 'Hesburger'],
  },
  {
    id: 'solaris',
    name: 'Solaris Keskus',
    latitude: 59.4339,
    longitude: 24.7551,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
      { number: 3, label: '3 этаж', image: null },
    ],
    stores: [
      'Rimi', 'Apollo Kino', 'Rahva Raamat', 'Apollo Raamatud', 'Nordic Hotels',
      'Vapiano', 'Starbucks', 'R-Kiosk',
    ],
  },
  {
    id: 'rocca',
    name: 'Rocca al Mare',
    latitude: 59.4264,
    longitude: 24.6514,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
    ],
    stores: [
      'Prisma', 'H&M', 'Reserved', 'Lindex', 'New Yorker', 'Sportland',
      'Euronics', 'Benu Apteek', 'McDonald\u2019s', 'Hesburger',
    ],
  },
];

export function findMallById(id: string): Mall | undefined {
  return MALLS.find((m) => m.id === id);
}
