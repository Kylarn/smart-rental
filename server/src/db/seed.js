import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..', '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data.db');
const UPLOADS = path.join(ROOT, 'uploads', 'seed');

for (const suffix of ['', '-wal', '-shm']) {
  const f = `${DB_PATH}${suffix}`;
  if (fs.existsSync(f)) fs.unlinkSync(f);
}
fs.mkdirSync(UPLOADS, { recursive: true });

const { getDb, insert, all } = await import('./index.js');
const db = getDb();

const ymd = (d) => d.toISOString().slice(0, 10);
const iso = (d) => d.toISOString();
const pad = (n) => String(n).padStart(2, '0');

function mulberry(seed) {
  let t = seed + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildingSvg(seed, palette, mode = 'day') {
  const rnd = mulberry(seed);
  const W = 1200;
  const H = 800;
  const parts = [];
  const skyTop = mode === 'evening' ? '#1b2a4a' : palette.sky1;
  const skyBot = mode === 'evening' ? '#e0714a' : palette.sky2;
  parts.push(`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skyTop}"/><stop offset="1" stop-color="${skyBot}"/></linearGradient>`);
  parts.push(`<linearGradient id="fac" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${palette.facade1}"/><stop offset="1" stop-color="${palette.facade2}"/></linearGradient>`);
  parts.push(`<linearGradient id="glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.glass1}"/><stop offset="1" stop-color="${palette.glass2}"/></linearGradient></defs>`);
  parts.push(`<rect width="${W}" height="${H}" fill="url(#sky)"/>`);

  if (mode === 'day') {
    parts.push(`<circle cx="${180 + rnd() * 200}" cy="130" r="58" fill="#fff" opacity="0.85"/>`);
  } else {
    parts.push(`<circle cx="${900 + rnd() * 150}" cy="120" r="46" fill="#fff7d6" opacity="0.95"/>`);
    for (let i = 0; i < 40; i += 1) {
      parts.push(`<circle cx="${rnd() * W}" cy="${rnd() * 320}" r="${1 + rnd() * 1.6}" fill="#fff" opacity="${0.3 + rnd() * 0.5}"/>`);
    }
  }

  const towers = 4 + Math.floor(rnd() * 3);
  let x = 40;
  for (let i = 0; i < towers; i += 1) {
    const bw = 130 + rnd() * 150;
    const bh = 260 + rnd() * 360;
    const by = H - 120 - bh;
    const shade = 0.85 + rnd() * 0.3;
    parts.push(`<rect x="${x}" y="${by}" width="${bw}" height="${bh}" rx="6" fill="url(#fac)" opacity="${shade.toFixed(2)}"/>`);
    const cols = Math.max(2, Math.floor(bw / 46));
    const rows = Math.max(3, Math.floor(bh / 58));
    const cw = bw / (cols + 1);
    const ch = bh / (rows + 1);
    for (let c = 0; c < cols; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        const lit = rnd();
        const fill = mode === 'evening' && lit > 0.45 ? '#ffd98a' : 'url(#glass)';
        const op = mode === 'evening' && lit > 0.45 ? 0.95 : 0.55 + rnd() * 0.4;
        parts.push(
          `<rect x="${(x + cw * (c + 0.5)).toFixed(1)}" y="${(by + ch * (r + 0.5)).toFixed(1)}" width="${(cw * 0.62).toFixed(1)}" height="${(ch * 0.55).toFixed(1)}" rx="3" fill="${fill}" opacity="${op.toFixed(2)}"/>`
        );
      }
    }
    x += bw + 18 + rnd() * 40;
    if (x > W - 140) break;
  }

  parts.push(`<rect x="0" y="${H - 120}" width="${W}" height="120" fill="${palette.ground}"/>`);
  parts.push(`<rect x="0" y="${H - 124}" width="${W}" height="8" fill="${palette.groundDark}" opacity="0.6"/>`);
  for (let i = 0; i < 7; i += 1) {
    const tx = 60 + i * 170 + rnd() * 40;
    parts.push(`<rect x="${tx}" y="${H - 190}" width="14" height="72" rx="6" fill="#4b3a2f"/>`);
    parts.push(`<circle cx="${tx + 7}" cy="${H - 200}" r="${34 + rnd() * 16}" fill="${palette.tree}"/>`);
  }
  parts.push(`<rect x="0" y="${H - 46}" width="${W}" height="10" fill="#ffffff" opacity="0.18"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`;
}

const PALETTES = [
  { sky1: '#dbeafe', sky2: '#f0f9ff', facade1: '#334155', facade2: '#64748b', glass1: '#38bdf8', glass2: '#0ea5e9', ground: '#1f2937', groundDark: '#111827', tree: '#22c55e' },
  { sky1: '#fce7f3', sky2: '#fff7ed', facade1: '#7c2d12', facade2: '#c2410c', glass1: '#a5f3fc', glass2: '#22d3ee', ground: '#292524', groundDark: '#1c1917', tree: '#16a34a' },
  { sky1: '#e0e7ff', sky2: '#f5f3ff', facade1: '#312e81', facade2: '#4f46e5', glass1: '#ddd6fe', glass2: '#a78bfa', ground: '#1e1b4b', groundDark: '#111336', tree: '#15803d' },
  { sky1: '#ccfbf1', sky2: '#ecfeff', facade1: '#134e4a', facade2: '#0d9488', glass1: '#f0fdfa', glass2: '#99f6e4', ground: '#042f2e', groundDark: '#022c2b', tree: '#4d7c0f' },
  { sky1: '#fef3c7', sky2: '#fffbeb', facade1: '#78350f', facade2: '#b45309', glass1: '#fef9c3', glass2: '#fde047', ground: '#292524', groundDark: '#171413', tree: '#65a30d' },
  { sky1: '#e2e8f0', sky2: '#f8fafc', facade1: '#0f172a', facade2: '#334155', glass1: '#bae6fd', glass2: '#38bdf8', ground: '#0f172a', groundDark: '#020617', tree: '#16a34a' },
];

const PROPERTY_DEFS = [
  {
    key: 'kilimani',
    name: 'Kilimani Heights Apartments',
    county: 'Nairobi',
    area: 'Kilimani',
    address: 'Ring Road Kilimani, Near Yaya Centre',
    type: 'Apartment',
    landlord: 'james',
    description:
      'Modern 12-unit apartment block in the heart of Kilimani. Walking distance to Yaya Centre, supermarkets and top schools. Features 24/7 security, backup water supply, borehole, and ample parking. Ideal for young professionals and families.',
    amenities: ['24/7 Security', 'Borehole Water', 'Backup Generator', 'Parking', 'CCTV', 'High Speed Internet', 'Lift', 'Gym'],
    units: [
      { type: 'Bedsitter', beds: 0, rent: 12500, count: 4 },
      { type: '1 Bedroom', beds: 1, rent: 24000, count: 4 },
      { type: '2 Bedroom', beds: 2, rent: 38000, count: 4 },
    ],
    palette: 0,
    occupancy: 0.65,
  },
  {
    key: 'westlands',
    name: 'Westlands Executive Suites',
    county: 'Nairobi',
    area: 'Westlands',
    address: 'Mpaka Road, Westlands',
    type: 'Serviced Apartments',
    landlord: 'james',
    description:
      'Upmarket serviced apartments on Mpaka Road with sweeping city views. Breathtaking interiors, concierge service, and proximity to Westlands business district, restaurants and nightlife.',
    amenities: ['Concierge', 'Swimming Pool', 'Gym', 'CCTV', 'Lift', 'Parking', 'Furnished', 'Smart Locks'],
    units: [
      { type: 'Studio', beds: 0, rent: 18500, count: 2 },
      { type: '1 Bedroom', beds: 1, rent: 32000, count: 3 },
      { type: '2 Bedroom', beds: 2, rent: 48000, count: 3 },
    ],
    palette: 2,
    occupancy: 0.6,
  },
  {
    key: 'kasarani',
    name: 'Kasarani Student Hostel',
    county: 'Nairobi',
    area: 'Kasarani',
    address: 'Thika Road, Near USIU',
    type: 'Hostel',
    landlord: 'james',
    description:
      'Affordable, secure hostel walking distance to USIU and CUEA. Perfect for students with study areas, unlimited water, and shared laundry facilities.',
    amenities: ['Study Hall', '24/7 Security', 'Water Tank', 'Laundry', 'Internet', 'CCTV'],
    units: [
      { type: 'Bedsitter', beds: 0, rent: 8500, count: 6 },
      { type: '1 Bedroom', beds: 1, rent: 13500, count: 4 },
    ],
    palette: 4,
    occupancy: 0.4,
  },
  {
    key: 'nyali',
    name: 'Nyali Bay Residences',
    county: 'Mombasa',
    area: 'Nyali',
    address: 'Links Road, Nyali',
    type: 'Apartment',
    landlord: 'james',
    description:
      'Coastal luxury apartments along Links Road, minutes from Nyali Beach and City Mall. Sea breeze, sunset views, and resort-style amenities make this a premium address on the coast.',
    amenities: ['Ocean View', 'Swimming Pool', 'Beach Shuttle', 'CCTV', 'Parking', 'Garden', 'Borehole', 'Lift'],
    units: [
      { type: '1 Bedroom', beds: 1, rent: 21000, count: 2 },
      { type: '2 Bedroom', beds: 2, rent: 33000, count: 2 },
      { type: '3 Bedroom', beds: 3, rent: 46000, count: 2 },
    ],
    palette: 3,
    occupancy: 0.5,
  },
  {
    key: 'nakuru',
    name: 'Milimani Gardens Nakuru',
    county: 'Nakuru',
    area: 'Milimani',
    address: 'Kenyatta Avenue, Milimani Estate',
    type: 'Townhouse',
    landlord: 'james',
    description:
      'Quiet, family-friendly townhouses in upscale Milimani Estate. Spacious layouts, mature gardens, and easy access to Nakuru CBD and top schools.',
    amenities: ['Garden', 'Parking', '24/7 Security', 'Water Tank', 'DSQ', 'Fenced Yard'],
    units: [
      { type: 'Bedsitter', beds: 0, rent: 9500, count: 4 },
      { type: '2 Bedroom', beds: 2, rent: 26000, count: 4 },
    ],
    palette: 1,
    occupancy: 0.35,
  },
  {
    key: 'kisumu',
    name: 'Kisumu Lakeside Court',
    county: 'Kisumu',
    area: 'Mamboleo',
    address: 'Kisumu-Kakamega Highway, Mamboleo',
    type: 'Apartment',
    landlord: 'james',
    description:
      'Newly built apartments along the Kisumu-Kakamega highway with lake views. Smart home features, ample parking, and convenient access to town and the airport.',
    amenities: ['Lake View', 'CCTV', 'Parking', 'Borehole', 'Internet', 'Security Gate'],
    units: [
      { type: 'Bedsitter', beds: 0, rent: 8000, count: 3 },
      { type: '1 Bedroom', beds: 1, rent: 15000, count: 3 },
    ],
    palette: 5,
    occupancy: 0.35,
  },
];

const NAMES = ['Peter Otieno'];

const slugEmail = (name, domain = 'tenant.co.ke') =>
  `${name.toLowerCase().replace(/\s+/g, '.')}@${domain}`;

console.log('Seeding Smart Rentals database...');

const password = async (p) => bcrypt.hash(p, 10);

const adminId = insert(
  `INSERT INTO users (role, full_name, email, phone, password_hash, county, bio) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ['admin', 'Smart Rentals Admin', 'admin@smartrentals.co.ke', '0700000001', await password('Admin@123'), 'Nairobi', 'Platform administrator']
);
const jamesId = insert(
  `INSERT INTO users (role, full_name, email, phone, password_hash, county, bio) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ['landlord', 'James Kamau', 'james@landlord.co.ke', '0722100200', await password('Landlord@123'), 'Nairobi', 'Property investor based in Nairobi with 8+ years experience.']
);
const caretakerId = insert(
  `INSERT INTO users (role, full_name, email, phone, password_hash, county, bio) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ['caretaker', 'Samuel Wafula', 'caretaker@smartrentals.co.ke', '0711222333', await password('Caretaker@123'), 'Nairobi', 'On-site caretaker for the Nairobi portfolio.']
);

const landlordIds = { james: jamesId };
const tenants = [];
for (let i = 0; i < NAMES.length; i += 1) {
  const id = insert(
    `INSERT INTO users (role, full_name, email, phone, password_hash, county) VALUES (?, ?, ?, ?, ?, ?)`,
    ['tenant', NAMES[i], slugEmail(NAMES[i]), `0712345${pad(i)}${i % 10}`, await password('Tenant@123'), null]
  );
  tenants.push({ id, name: NAMES[i] });
}

const imagesFor = (def, idx) => {
  const files = [];
  const modes = ['day', 'evening', 'day'];
  for (let i = 0; i < 3; i += 1) {
    const svg = buildingSvg(idx * 17 + i * 5 + 3, PALETTES[def.palette], modes[i]);
    const file = `${def.key}-${i + 1}.svg`;
    fs.writeFileSync(path.join(UPLOADS, file), svg);
    files.push(`/uploads/seed/${file}`);
  }
  return files;
};

const propertyIdByKey = {};
const allUnits = [];

PROPERTY_DEFS.forEach((def, idx) => {
  const propertyId = insert(
    `INSERT INTO properties (landlord_id, name, county, area, address, property_type, description, amenities, images, status, views)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [
      landlordIds[def.landlord],
      def.name,
      def.county,
      def.area,
      def.address,
      def.type,
      def.description,
      JSON.stringify(def.amenities),
      JSON.stringify(imagesFor(def, idx)),
      120 + idx * 87,
    ]
  );
  propertyIdByKey[def.key] = propertyId;

  let n = 1;
  def.units.forEach((group) => {
    for (let i = 0; i < group.count; i += 1) {
      const unitId = insert(
        `INSERT INTO units (property_id, unit_number, floor, unit_type, bedrooms, rent, deposit, size_sqm, status, amenities)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'vacant', ?)`,
        [
          propertyId,
          `${String.fromCharCode(65 + Math.floor(n / 5))}${n}`,
          `Floor ${Math.ceil(n / 4)}`,
          group.type,
          group.beds,
          group.rent,
          group.rent,
          group.beds === 0 ? 22 + (n % 3) * 4 : 35 + group.beds * 18,
          JSON.stringify(group.beds >= 2 ? ['Balcony', 'Master Ensuite'] : group.beds === 1 ? ['Balcony'] : ['Built-in Wardrobe']),
        ]
      );
      allUnits.push({ id: unitId, propertyId, key: def.key, rent: group.rent, type: group.type });
      n += 1;
    }
  });
});

let tenantCursor = 0;
const activeLeases = [];

const assignmentSeeds = [
  [caretakerId, jamesId, ['kilimani', 'westlands', 'kasarani', 'nyali', 'nakuru', 'kisumu']],
];
assignmentSeeds.forEach(([caretakerUserId, assignedBy, keys]) => {
  keys.forEach((k) => {
    insert('INSERT INTO property_caretakers (property_id, caretaker_id, assigned_by) VALUES (?, ?, ?)', [
      propertyIdByKey[k],
      caretakerUserId,
      assignedBy,
    ]);
  });
});
PROPERTY_DEFS.forEach((def) => {
  const units = allUnits.filter((u) => u.key === def.key);
  const occupy = Math.round(units.length * def.occupancy);
  for (let i = 0; i < occupy && tenantCursor < tenants.length; i += 1) {
    const unit = units[i];
    const tenant = tenants[tenantCursor];
    tenantCursor += 1;
    const start = new Date();
    start.setMonth(start.getMonth() - (2 + (i % 7)));
    start.setDate(def.key.length % 2 === 0 ? 1 : 5);
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + 1);
    const leaseId = insert(
      `INSERT INTO leases (property_id, unit_id, tenant_id, start_date, end_date, rent, deposit, frequency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [unit.propertyId, unit.id, tenant.id, ymd(start), ymd(end), unit.rent, unit.rent, i % 5 === 0 ? 'quarterly' : 'monthly', 'active']
    );
    db.prepare(`UPDATE units SET status = 'occupied' WHERE id = ?`).run(unit.id);
    activeLeases.push({ id: leaseId, unit_id: unit.id, propertyId: unit.propertyId, rent: unit.rent, tenantId: tenant.id, start, end, frequency: i % 5 === 0 ? 'quarterly' : 'monthly' });
  }
});

let receiptSeq = 0;
const receiptNo = () => {
  const d = new Date();
  receiptSeq += 1;
  return `SR-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${String(receiptSeq).padStart(4, '0')}`;
};

activeLeases.forEach((lease) => {
  const startMonthOffset = Math.max(0, Math.floor((Date.now() - lease.start.getTime()) / (30 * 86400000)));
  const monthsBack = Math.min(6, startMonthOffset);
  const monthsCovered = lease.frequency === 'quarterly' ? 3 : 1;
  let m = 0;
  while (m < monthsBack) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (monthsBack - m));
    const period = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const amount = lease.rent * monthsCovered;
    const paidAt = new Date(d);
    paidAt.setDate(3 + (lease.id % 5));
    if (paidAt > new Date()) paidAt.setTime(Date.now() - 86400000 * 2);
    insert(
      `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, phone, reference, receipt_number, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`,
      [
        lease.tenantId,
        lease.propertyId,
        lease.unit_id,
        lease.id,
        amount,
        period,
        monthsCovered,
        lease.id % 4 === 0 ? 'bank' : 'mpesa',
        lease.id % 4 === 0 ? 'bank' : 'mpesa',
        `07${(10000000 + lease.id * 137).toString().slice(0, 8)}`,
        `MPE${Date.now().toString().slice(-8)}${lease.id}`,
        receiptNo(),
        iso(paidAt),
      ]
    );
    m += monthsCovered;
  }

  if (lease.id % 3 === 0) {
    const d = new Date();
    d.setDate(1);
    const period = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    insert(
      `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, phone, reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'mpesa', 'mpesa', 'processing', ?, ?, ?)`,
      [
        lease.tenantId,
        lease.propertyId,
        lease.unit_id || lease.id,
        lease.id,
        lease.rent,
        period,
        1,
        `07${(10000000 + lease.id * 137).toString().slice(0, 8)}`,
        `PENDING${lease.id}`,
        iso(new Date(Date.now() - 1000 * 60 * 30)),
      ]
    );
  }
  if (lease.id % 7 === 0) {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    const period = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    insert(
      `INSERT INTO payments (tenant_id, property_id, unit_id, lease_id, amount, period, months_covered, method, provider, status, phone, reference, failure_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'mpesa', 'mpesa', 'failed', ?, ?, 'The M-Pesa request was cancelled by the user', ?)`,
      [
        lease.tenantId,
        lease.propertyId,
        lease.unit_id || lease.id,
        lease.id,
        lease.rent,
        period,
        1,
        `07${(10000000 + lease.id * 137).toString().slice(0, 8)}`,
        `FAIL${lease.id}`,
        iso(new Date(Date.now() - 1000 * 60 * 60 * 24 * 9)),
      ]
    );
  }
});

const billSeed = activeLeases.length ? [activeLeases[0]] : [];
billSeed.forEach((lease) => {
  const now = new Date();
  const cur = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevKey = `${prev.getFullYear()}-${pad(prev.getMonth() + 1)}`;
  insert(
    `INSERT INTO utility_bills (property_id, unit_id, tenant_id, category, period, amount, status, notes)
     VALUES (?, ?, ?, 'Water', ?, 750, 'unpaid', 'Shared meter reading for the flat')`,
    [lease.propertyId, lease.unit_id, lease.tenantId, cur]
  );
  const paidAt = new Date(Date.now() - 86400000 * 6);
  insert(
    `INSERT INTO utility_bills (property_id, unit_id, tenant_id, category, period, amount, status, paid_at, payment_method, payment_reference, notes)
     VALUES (?, ?, ?, 'Electricity', ?, 1400, 'paid', ?, 'mpesa', ?, 'KPLC bill settled')`,
    [lease.propertyId, lease.unit_id, lease.tenantId, prevKey, iso(paidAt), `MPE${Math.floor(Math.random() * 1e8)}`]
  );
});

const maintenanceSeeds = [
  ['Leaking kitchen sink', 'Water is dripping under the kitchen sink and the cabinet is getting damaged.', 'Plumbing', 'high', 'in_progress', 'kilimani', 'John plumber - 0711223344', 2500],
  ['Broken window latch', 'Bedroom window latch broke, cannot lock the window at night.', 'Carpentry', 'medium', 'submitted', 'westlands', '', null, 'tenant'],
  ['No hot water', 'Water heater has not been producing hot water for three days.', 'Electrical', 'urgent', 'under_review', 'kasarani', '', null],
  ['Corridor light out', 'The stairwell light on floor 2 has been out since Tuesday.', 'Electrical', 'low', 'assigned', 'kilimani', 'Peter - 0722556677', 1200],
  ['Blocked drainage', 'Raw sewage backing up in the backyard drain.', 'Plumbing', 'urgent', 'in_progress', 'nakuru', 'Flow Masters - 0733998877', 6500],
  ['Ceiling paint peeling', 'Paint peeling off the living room ceiling after the rains.', 'Painting', 'low', 'completed', 'nyali', 'Coast Decor - 0745112233', 4800],
  ['Dripping roof', 'Roof leaks into the second bedroom during heavy rain.', 'Roofing', 'high', 'under_review', 'kisumu', '', null],
  ['Gate remote not working', 'Parking gate remote stopped responding.', 'Security', 'medium', 'submitted', 'westlands', '', null],
  ['Cracked bathroom tiles', 'Two tiles cracked near the shower area.', 'General', 'low', 'closed', 'kilimani', '', 1500],
  ['Fridge not cooling', 'The common area fridge is not cooling at all.', 'Appliance', 'medium', 'completed', 'kasarani', 'Cool Tech - 0799887766', 3200],
];

maintenanceSeeds.forEach(([title, desc, category, priority, status, key, assigned, cost], i) => {
  const units = allUnits.filter((u) => u.key === key);
  const unit = units[i % units.length];
  if (!unit) return;
  const lease = activeLeases.find((l) => l.unit_id === unit.id);
  const created = new Date(Date.now() - (i + 2) * 86400000 * 2);
  insert(
    `INSERT INTO maintenance_requests (property_id, unit_id, tenant_id, title, description, category, priority, status, photos, assigned_to, actual_cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?)`,
    [unit.propertyId, unit.id, lease ? lease.tenantId : null, title, desc, category, priority, status, assigned || null, cost, iso(created)]
  );
});

const appDefs = [
  ['Linda Atieno', 'linda.atieno@gmail.com', '0722111999', 'kilimani', 'pending', 'I am a young professional working at a bank in Upper Hill. Looking for a clean bedsitter close to work.'],
  ['Mark Ouma', 'mark.ouma@yahoo.com', '0711222888', 'westlands', 'under_review', 'Relocating from Kisumu for a new job. Prefer a furnished 1 bedroom.'],
  ['Susan Mwikali', 'susan.mwikali@gmail.com', '0733444555', 'kasarani', 'approved', 'Second year student at USIU. Need a quiet bedsitter for studying.'],
  ['Ali Hassan', 'ali.hassan@gmail.com', '0745555666', 'nyali', 'rejected', 'Looking for a place near the beach for my family.'],
  ['Joy Wambui', 'joy.wambui@gmail.com', '0722999000', 'nakuru', 'info_requested', 'Family of four, need a compound for the kids to play.'],
  ['Brian Wekesa', 'brian.wekesa@gmail.com', '0799111222', 'kisumu', 'pending', 'Working remotely, need reliable internet and a balcony.'],
];

appDefs.forEach(([name, email, phone, key, status, message], i) => {
  const def = PROPERTY_DEFS.find((d) => d.key === key);
  const unit = allUnits.filter((u) => u.key === key)[i % 3];
  const moveIn = new Date(Date.now() + (i + 2) * 86400000 * 5);
  insert(
    `INSERT INTO applications (property_id, unit_id, applicant_id, full_name, email, phone, move_in_date, occupants, message, status, reviewer_notes, reviewed_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      propertyIdByKey[key],
      i % 2 === 0 ? unit?.id || null : null,
      null,
      name,
      email,
      phone,
      ymd(moveIn),
      i % 3 === 0 ? 2 : 1,
      message,
      status,
      status === 'rejected' ? 'Unit requirements not met at this time.' : status === 'info_requested' ? 'Please provide proof of income and a copy of your ID.' : null,
      status !== 'pending' ? landlordIds[def.landlord] : null,
    ]
  );
});

const anns = [
  ['Water maintenance on Saturday', 'Water supply will be interrupted from 9am to 2pm on Saturday for tank cleaning and plumbing works. Please store enough water in advance.', 'kilimani'],
  ['New year rent review notice', 'Rent for 2027 will remain unchanged for all existing tenants as a token of appreciation for your continued tenancy.', 'westlands'],
  ['Security advisory', 'Please ensure the main gate is closed after 10pm. Report any suspicious activity to the on-duty guard immediately.', 'kasarani'],
  ['Swimming pool reopening', 'The swimming pool reopens this weekend after maintenance. Opening hours: 6am - 8pm daily.', 'nyali'],
];
anns.forEach(([title, body, key]) => {
  const def = PROPERTY_DEFS.find((d) => d.key === key);
  insert('INSERT INTO announcements (property_id, landlord_id, title, body) VALUES (?, ?, ?, ?)', [
    propertyIdByKey[key],
    landlordIds[def.landlord],
    title,
    body,
  ]);
});

const seededTenants = tenants.slice(0, 6);
seededTenants.forEach((t, i) => {
  const def = PROPERTY_DEFS[i % PROPERTY_DEFS.length];
  insert('INSERT INTO messages (sender_id, recipient_id, subject, body, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    t.id,
    landlordIds[def.landlord],
    'Rent payment confirmation',
    `Hello, I have sent my rent for this month via M-Pesa. Kindly confirm once received. Thank you.`,
    i % 2,
    iso(new Date(Date.now() - (i + 1) * 86400000)),
  ]);
  insert('INSERT INTO messages (sender_id, recipient_id, subject, body, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
    landlordIds[def.landlord],
    t.id,
    'Re: Rent payment confirmation',
    `Received, thank you. Your receipt has been generated on the portal. Do reach out if you need anything else.`,
    1,
    iso(new Date(Date.now() - i * 86400000 + 3600000)),
  ]);
});

const notifSeeds = [
  [jamesId, 'success', 'Payment received', 'Peter Otieno paid rent for this month.', '/landlord/payments'],
  [jamesId, 'application', 'New rental application', 'Linda Atieno applied to rent at Kilimani Heights Apartments.', '/landlord/applications'],
  [jamesId, 'warning', 'Lease expiring soon', 'Peter Otieno’s lease ends in 21 days.', '/landlord/leases'],
  [jamesId, 'maintenance', 'New maintenance request', 'Blocked drainage at Milimani Gardens Nakuru.', '/landlord/maintenance'],
  [tenants[0].id, 'success', 'Payment received', 'Your payment was received. Receipt available.', '/tenant/payments'],
  [tenants[0].id, 'reminder', 'Rent due soon', 'Rent is due in 3 days.', '/tenant/payments'],
  [tenants[0].id, 'maintenance', 'Maintenance update', 'Your request “Corridor light out” has been assigned.', '/tenant/maintenance'],
  [tenants[0].id, 'announcement', 'Announcement: Water maintenance on Saturday', 'Water supply will be interrupted from 9am to 2pm.', '/tenant/notifications'],
  [adminId, 'info', 'Daily summary', 'Platform activity report generated for today.', '/admin'],
];

notifSeeds.forEach(([uid, type, title, body, link]) => {
  insert('INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, ?, ?, ?, ?)', [uid, type, title, body, link]);
});

const auditSeeds = [
  [adminId, 'auth.login', 'user', adminId, 'Admin signed in', 'admin', null],
  [jamesId, 'property.created', 'property', propertyIdByKey.kilimani, 'Kilimani Heights Apartments', 'landlord', propertyIdByKey.kilimani],
  [jamesId, 'payment.recorded', 'payment', null, 'Cash payment recorded', 'landlord', propertyIdByKey.kilimani],
  [caretakerId, 'caretaker.assigned', 'property', propertyIdByKey.westlands, 'Assigned to manage property', 'admin', propertyIdByKey.westlands],
  [caretakerId, 'maintenance.updated', 'maintenance', null, 'Marked corridor light as assigned', 'caretaker', propertyIdByKey.kilimani],
  [adminId, 'admin.settings_updated', 'settings', null, 'Platform settings updated', 'admin', null],
];
auditSeeds.forEach(([uid, action, entity, entityId, details, actorRole, propertyId]) => {
  insert('INSERT INTO audit_logs (user_id, action, entity, entity_id, details, property_id, actor_role) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    uid,
    action,
    entity,
    entityId,
    details,
    propertyId,
    actorRole,
  ]);
});

[
  ['platform_name', 'Smart Rentals'],
  ['support_email', 'support@smartrentals.co.ke'],
  ['support_phone', '0700000000'],
  ['currency', 'KES'],
  ['registration_enabled', 'true'],
  ['mpesa_mode', 'sandbox'],
  ['rent_reminder_days', '3'],
  ['lease_expiry_days', '30'],
].forEach(([k, v]) => insert('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]));

const counts = {
  users: all('SELECT COUNT(*) AS c FROM users')[0].c,
  properties: all('SELECT COUNT(*) AS c FROM properties')[0].c,
  units: all('SELECT COUNT(*) AS c FROM units')[0].c,
  leases: all('SELECT COUNT(*) AS c FROM leases')[0].c,
  payments: all('SELECT COUNT(*) AS c FROM payments')[0].c,
  maintenance: all('SELECT COUNT(*) AS c FROM maintenance_requests')[0].c,
  applications: all('SELECT COUNT(*) AS c FROM applications')[0].c,
  utilityBills: all('SELECT COUNT(*) AS c FROM utility_bills')[0].c,
};

console.log('Seed complete:', counts);
console.log('\nDemo accounts:');
console.log('  Admin     admin@smartrentals.co.ke     / Admin@123');
console.log('  Landlord  james@landlord.co.ke         / Landlord@123');
console.log('  Caretaker caretaker@smartrentals.co.ke / Caretaker@123');
console.log('  Tenant    peter.otieno@tenant.co.ke    / Tenant@123');
process.exit(0);
