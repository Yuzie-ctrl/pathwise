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
}

// Tallinn malls — coordinates are approximate (OSM-derived).
// Only T1 currently has real floor-plan imagery; other malls get placeholder
// floors (gray background with "Карта появится скоро") until future imports.
export const MALLS: Mall[] = [
  {
    id: 't1',
    name: 'T1 Mall of Tallinn',
    latitude: 59.4262,
    longitude: 24.7746,
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
  },
  {
    id: 'ulemiste',
    name: 'Ülemiste Keskus',
    latitude: 59.4242,
    longitude: 24.795,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
      { number: 3, label: '3 этаж', image: null },
    ],
  },
  {
    id: 'viru',
    name: 'Viru Keskus',
    latitude: 59.4372,
    longitude: 24.755,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
      { number: 3, label: '3 этаж', image: null },
      { number: 4, label: '4 этаж', image: null },
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
  },
  {
    id: 'hobujaama',
    name: 'Hobujaama',
    latitude: 59.4352,
    longitude: 24.7607,
    floors: [{ number: 1, label: '1 этаж', image: null }],
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
  },
  {
    id: 'umera',
    name: 'Ümera Keskus',
    latitude: 59.4407,
    longitude: 24.8522,
    floors: [{ number: 1, label: '1 этаж', image: null }],
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
  },
  {
    id: 'rocca',
    name: 'Rocca al Mare',
    latitude: 59.4292,
    longitude: 24.6588,
    floors: [
      { number: 1, label: '1 этаж', image: null },
      { number: 2, label: '2 этаж', image: null },
    ],
  },
];

export function findMallById(id: string): Mall | undefined {
  return MALLS.find((m) => m.id === id);
}
