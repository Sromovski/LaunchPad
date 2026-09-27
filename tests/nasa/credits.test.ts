import { describe, expect, it } from 'vitest';
import { CLEAR_CREDITS, checkCredit, extractDescriptionCredits, normalizeCredit } from '../../src/nasa/credits.js';

const check = (credits: (string | undefined)[], description = '') => checkCredit({ credits, description });

describe('normalizeCredit', () => {
  it.each([
    ['  NASA / JPL-Caltech. ', 'NASA/JPL-Caltech'],
    ['NASA’s Jet Propulsion Laboratory', 'NASA/JPL'],
    ["NASA's Jet Propulsion Laboratory", 'NASA/JPL'],
    ['NASA Goddard Space Flight Center', 'NASA/GSFC'],
    ["NASA's Goddard Space Flight Center", 'NASA/GSFC'],
    ['NASA Goddard', 'NASA/GSFC'],
    ['NASA Johnson Space Center', 'NASA/JSC'],
    ["NASA's Kennedy Space Center", 'NASA/KSC'],
    ['NASA Marshall Space Flight Center', 'NASA/MSFC'],
    ['National Aeronautics and Space Administration', 'NASA'],
    ['nasa/jpl-caltech', 'NASA/JPL-Caltech'],
    ['NASA/JPL-Caltech//ASU/MSSS', 'NASA/JPL-Caltech/ASU/MSSS'], // real double slash in NASA data (video 5)
  ])('%s → %s', (input, expected) => {
    expect(normalizeCredit(input)).toBe(expected);
  });

  it('leaves unknown credits alone (apart from whitespace)', () => {
    expect(normalizeCredit('NASA/JPL-Caltech/MSSS')).toBe('NASA/JPL-Caltech/MSSS');
  });
});

describe('extractDescriptionCredits', () => {
  it('finds a trailing "Credit:" line', () => {
    expect(extractDescriptionCredits('Blah blah.  Credit: NASA/JPL-Caltech/University of Arizona')).toEqual([
      'NASA/JPL-Caltech/University of Arizona',
    ]);
  });

  it('finds "Image credit:" and stops at a double space', () => {
    expect(extractDescriptionCredits('Image credit: NASA/JPL-Caltech/MSSS.  More text here.')).toEqual([
      'NASA/JPL-Caltech/MSSS',
    ]);
  });

  it('returns [] when there is none', () => {
    expect(extractDescriptionCredits('The sun sets over Gale Crater.')).toEqual([]);
  });
});

describe('clear', () => {
  it.each(CLEAR_CREDITS)('%s is clear', (credit) => {
    expect(check([credit]).status).toBe('clear');
  });

  it('alias of an allowlisted credit is clear', () => {
    expect(check(["NASA's Jet Propulsion Laboratory"]).status).toBe('clear');
  });

  it('the same allowlisted credit in two fields is clear', () => {
    expect(check(['NASA/JPL-Caltech', 'NASA/JPL-Caltech'], 'Credit: NASA/JPL-Caltech').status).toBe('clear');
  });

  it('display credit is the normalized form', () => {
    expect(check(['NASA/JPL-Caltech']).credit).toBe('NASA/JPL-Caltech');
  });
});

describe('needs_review', () => {
  it.each([
    'NASA/JPL-Caltech/MSSS',
    'NASA/JPL-Caltech/MSSS/Texas A&M Univ.',
    'NASA/JPL-Caltech/ASU/MSSS',
    'NASA/JPL-Caltech/University of Arizona',
    'NASA/ESA',
    'NASA, ESA, STScI',
    'NASA/Bill Ingalls',
    'NASA/SpaceX',
  ])('co-credit %s', (credit) => {
    const r = check([credit]);
    expect(r.status).toBe('needs_review');
    expect(r.note).toMatch(/co-credit/i);
  });

  it('no credit at all', () => {
    const r = check([undefined, '']);
    expect(r.status).toBe('needs_review');
    expect(r.note).toMatch(/no credit/i);
  });

  it('bare person name without NASA (cannot tell staff from private) → review', () => {
    expect(check(['Bill Ingalls']).status).toBe('needs_review');
  });

  it.each(['Courtesy of the Smith Lab', 'Photo © 2020', 'Used with permission of the owner', 'Copyright 2019 J. Doe'])(
    'description flag: %s',
    (desc) => {
      const r = check(['NASA'], desc);
      expect(r.status).toBe('needs_review');
      expect(r.note).toMatch(/description/i);
    },
  );

  it('description credit is stricter than the field credit → strictest wins', () => {
    // Real case: video "photographer" is NASA's JPL, but description credits 8 co-owners.
    const r = check(
      ["NASA's Jet Propulsion Laboratory"],
      'Blah.  Credit: NASA/JPL-Caltech/University of Maryland/University of Arizona/IPGP/Manchu/Bureau 21/ETH Zurich/Kirschner/van Driel',
    );
    expect(r.status).toBe('needs_review');
    expect(r.credit).toMatch(/University of Maryland/);
  });
});

describe('rejected', () => {
  it.each(['ESA', 'ESA/Hubble', 'ESA/DLR/FU Berlin'])('ESA-only: %s', (credit) => {
    expect(check([credit]).status).toBe('rejected');
  });

  it.each(['AP Photo/John Doe', 'Associated Press', 'Reuters', 'Getty Images', 'NASA/Getty Images', 'AFP'])(
    'news agency: %s',
    (credit) => {
      expect(check([credit]).status).toBe('rejected');
    },
  );

  it.each(['© John Doe', 'Copyright Jane Smith', 'Jane Smith ©'])('private owner: %s', (credit) => {
    expect(check([credit]).status).toBe('rejected');
  });

  it('rejected beats clear across fields', () => {
    expect(check(['NASA', 'Reuters']).status).toBe('rejected');
  });

  it('does not treat words containing "ap" as AP', () => {
    expect(check(['NASA/JPL-Caltech/Univ. of Applied Physics']).status).toBe('needs_review');
  });
});
