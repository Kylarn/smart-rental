import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Building2,
  Users,
  Wallet,
  ReceiptText,
  Wrench,
  BarChart3,
  CheckCircle2,
  ArrowRight,
  Menu,
  X,
  LayoutDashboard,
  MapPin,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Button, Spinner } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { kes } from '../lib/format.js';

const MOCK_PAYMENTS = [
  { name: 'A. Wanjiku', unit: 'B2', method: 'M-Pesa', amount: 12500 },
  { name: 'J. Mwangi', unit: 'A1', method: 'Bank', amount: 12500 },
  { name: 'S. Kariuki', unit: 'C3', method: 'M-Pesa', amount: 12500 },
];

export default function Home() {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [listings, setListings] = useState([]);
  const [listingsLoading, setListingsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api
      .get('/api/market/properties?sort=newest')
      .then((data) => {
        const available = (data.properties || []).filter((p) => Number(p.available_units || 0) > 0);
        if (active) setListings(available.slice(0, 6));
      })
      .catch(() => {
        if (active) setListings([]);
      })
      .finally(() => {
        if (active) setListingsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="hp">
      <a className="skip-link" href="#hp-main">Skip to content</a>

      <header className="hp-nav">
        <div className="hp-nav-inner">
          <Link to="/" className="hp-brand" aria-label="Smart Rentals home" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark">SR</span>
            <span className="brand-name">
              Smart <strong>Rentals</strong>
            </span>
          </Link>

          <nav className="hp-links" aria-label="Main navigation">
            <a href="#hero">Home</a>
            <a href="#listings">Available units</a>
            <a href="#features">Features</a>
            <a href="#about">About</a>
          </nav>

          <div className="hp-cta">
            {user ? (
              <Link to="/app" onClick={() => setMenuOpen(false)}>
                <Button variant="primary" size="sm">
                  Go to dashboard <ArrowRight size={15} />
                </Button>
              </Link>
            ) : (
              <>
                <Link to="/login" onClick={() => setMenuOpen(false)}>
                  <Button variant="ghost" size="sm" style={{ color: '#cbd5e1' }}>
                    Sign In
                  </Button>
                </Link>
                <Link to="/register" onClick={() => setMenuOpen(false)}>
                  <Button variant="primary" size="sm">
                    Get Started
                  </Button>
                </Link>
              </>
            )}
          </div>

          <button
            type="button"
            className="hp-menu-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {menuOpen ? (
          <nav className="hp-mobile" aria-label="Mobile navigation">
            <a href="#hero" onClick={() => setMenuOpen(false)}>Home</a>
            <a href="#listings" onClick={() => setMenuOpen(false)}>Available units</a>
            <a href="#features" onClick={() => setMenuOpen(false)}>Features</a>
            <a href="#about" onClick={() => setMenuOpen(false)}>About</a>
            {user ? (
              <Link to="/app" onClick={() => setMenuOpen(false)}>Dashboard</Link>
            ) : (
              <>
                <Link to="/login" onClick={() => setMenuOpen(false)}>Sign In</Link>
                <Link to="/register" onClick={() => setMenuOpen(false)}>Get Started</Link>
              </>
            )}
          </nav>
        ) : null}
      </header>

      <main id="hp-main">
        <section className="hp-hero" id="hero" aria-labelledby="hp-hero-title">
          <div className="hp-hero-grid">
            <div className="hp-hero-copy">
              <span className="hp-eyebrow">Rental management for Kenyan landlords</span>
              <h1 id="hp-hero-title">Manage your rental property with ease</h1>
              <p>
                Smart Rentals helps Kenyan property owners manage tenants, track and collect rent, monitor
                arrears, handle maintenance and review financial reports — from one dashboard.
              </p>
              <div className="hp-hero-actions">
                <Link to="/register" onClick={() => setMenuOpen(false)}>
                  <Button variant="primary" size="lg">
                    Get Started <ArrowRight size={16} />
                  </Button>
                </Link>
                <Link to="/login" onClick={() => setMenuOpen(false)}>
                  <Button variant="secondary" size="lg">
                    Sign In
                  </Button>
                </Link>
              </div>
              <ul className="hp-points">
                <li><CheckCircle2 size={16} /> Everything in one place — no paperwork</li>
                <li><CheckCircle2 size={16} /> M-Pesa rent collection built in</li>
              </ul>
            </div>

            <div className="hp-hero-visual" aria-hidden="true">
              <DashboardMockup />
            </div>
          </div>
        </section>

        <section className="hp-section hp-alt" id="listings" aria-labelledby="hp-listings-title">
          <div className="hp-wrap">
            <div className="hp-head">
              <span className="hp-eyebrow">Available now</span>
              <h2 id="hp-listings-title">Find your next home</h2>
              <p>Browse vacant units from landlords on Smart Rentals. Apply online in minutes — no account needed to get started.</p>
            </div>

            {listingsLoading ? (
              <div className="hp-listings-state">
                <Spinner label="Loading available rentals…" />
              </div>
            ) : listings.length ? (
              <div className="hp-listings">
                {listings.map((p) => (
                  <ListingCard key={p.id} property={p} />
                ))}
              </div>
            ) : (
              <div className="hp-listings-state">
                <p className="muted">No units are listed right now. Check back soon.</p>
                <Link to="/register" onClick={() => setMenuOpen(false)}>
                  <Button variant="primary" size="sm">List your property</Button>
                </Link>
              </div>
            )}
          </div>
        </section>

        <section className="hp-section" id="features" aria-labelledby="hp-features-title">
          <div className="hp-wrap">
            <div className="hp-head">
              <span className="hp-eyebrow">Everything you need</span>
              <h2 id="hp-features-title">One dashboard for the whole rental business</h2>
              <p>From the first unit to rent collection and reporting — run it all without spreadsheets or diaries.</p>
            </div>
            <div className="hp-features">
              <Feature icon={Building2} title="Buildings & unit management" text="Add properties, create units and track occupancy across your portfolio in real time." />
              <Feature icon={Users} title="Tenants & lease management" text="Sign tenants, generate leases, set rent schedules and manage renewals, terminations and move-outs." />
              <Feature icon={Wallet} title="Rent tracking & M-Pesa payments" text="Collect rent via M-Pesa, record manual payments and reconcile every shilling as it lands." />
              <Feature icon={ReceiptText} title="Arrears & receipts" text="See who owes what, issue a receipt for every payment and stay on top of outstanding rent." />
              <Feature icon={Wrench} title="Maintenance & announcements" text="Tenants report issues, your team tracks repairs, and you broadcast announcements to your buildings." />
              <Feature icon={BarChart3} title="Financial reports & caretaker management" text="Review income, expenses and occupancy reports, and give caretakers controlled access to their sites." />
            </div>
          </div>
        </section>

        <section className="hp-section hp-alt" id="about" aria-labelledby="hp-about-title">
          <div className="hp-wrap">
            <div className="hp-head">
              <span className="hp-eyebrow">About Smart Rentals</span>
              <h2 id="hp-about-title">Built for Kenyan building owners</h2>
              <p>
                Smart Rentals is a hosted rental-management platform designed around the way Kenyan landlords
                manage property — so your data and decisions live in one trusted place.
              </p>
            </div>
            <div className="hp-steps">
              <Step n="1" title="Set up your buildings" text="Add each property and create its units with monthly rent. Your portfolio is ready in minutes." />
              <Step n="2" title="Sign your tenants" text="Create tenants, generate leases and move everyone onto clear rent schedules." />
              <Step n="3" title="Collect & track" text="Receive rent, monitor arrears, record expenses and pull financial reports whenever you need them." />
            </div>
          </div>
        </section>

        <section className="hp-cta-band" aria-labelledby="hp-cta-title">
          <div className="hp-wrap">
            <h2 id="hp-cta-title">Ready to manage your rentals better?</h2>
            <p>Bring your entire portfolio onto one dashboard and keep every building under control.</p>
            <Link to="/register" onClick={() => setMenuOpen(false)}>
              <Button variant="primary" size="lg">
                Get Started Today <ArrowRight size={16} />
              </Button>
            </Link>
          </div>
        </section>
      </main>

      <footer className="hp-footer">
        <div className="hp-wrap hp-footer-inner">
          <div className="hp-brand">
            <span className="brand-mark">SR</span>
            <span className="brand-name">
              Smart <strong>Rentals</strong>
            </span>
          </div>
          <nav className="hp-footer-links" aria-label="Footer navigation">
            <a href="#hero">Home</a>
            <a href="#listings">Available units</a>
            <a href="#features">Features</a>
            <a href="#about">About</a>
            <Link to="/login">Sign In</Link>
            <Link to="/register">Get Started</Link>
          </nav>
        </div>
        <p className="hp-copy">© {new Date().getFullYear()} Smart Rentals. All rights reserved.</p>
      </footer>
    </div>
  );
}

function Feature({ icon: Icon, title, text }) {
  return (
    <div className="hp-feature">
      <span className="hp-feature-icon"><Icon size={20} /></span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function Step({ n, title, text }) {
  return (
    <div className="hp-step">
      <span className="hp-step-n">{n}</span>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}

function ListingCard({ property: p }) {
  const location = [p.area, p.county].filter(Boolean).join(', ');
  const img = p.images?.[0] || null;
  const available = Number(p.available_units || 0);

  return (
    <Link to={`/property/${p.id}`} className="property-card hp-listing">
      <div className="property-thumb">
        {img ? (
          <img src={img} alt={p.name} />
        ) : (
          <span className="hp-listing-thumb-icon"><Building2 size={34} /></span>
        )}
      </div>
      <div className="property-body">
        <h3>{p.name}</h3>
        <span className="property-loc"><MapPin size={14} /> {location || 'Kenya'}</span>
        <div className="chip-row">
          <span className="chip"><Building2 size={13} /> {p.property_type}</span>
          <span className="chip">{available} vacant</span>
        </div>
        <div className="property-foot">
          <div className="price">{p.min_rent ? kes(p.min_rent) : '—'} <small>/mo</small></div>
          <span className="link">View <ArrowRight size={14} /></span>
        </div>
      </div>
    </Link>
  );
}

function DashboardMockup() {
  return (
    <div className="hp-mock" role="img" aria-label="Illustrative preview of the Smart Rentals management dashboard">
      <div className="hp-mock-note">Illustrative preview</div>
      <div className="hp-mock-side">
        <div className="hp-mock-brand"><span className="brand-mark">SR</span></div>
        <span className="hp-mock-side-item active"><LayoutDashboard size={15} /> Dashboard</span>
        <span className="hp-mock-side-item"><Building2 size={15} /> Properties</span>
        <span className="hp-mock-side-item"><Users size={15} /> Tenants</span>
        <span className="hp-mock-side-item"><Wallet size={15} /> Payments</span>
        <span className="hp-mock-side-item"><Wrench size={15} /> Maintenance</span>
        <span className="hp-mock-side-item"><BarChart3 size={15} /> Reports</span>
      </div>
      <div className="hp-mock-main">
        <div className="hp-mock-stats">
          <MockStat label="Rent collected (month)" value={kes(182500)} />
          <MockStat label="Outstanding" value={kes(37500)} />
          <MockStat label="Occupancy" value="92%" />
          <MockStat label="Open maintenance" value="6" />
        </div>
        <div className="hp-mock-chart">
          <div className="hp-mock-chart-head">
            <span className="hp-mock-chart-title">Rent collection — last 6 months</span>
            <span className="hp-mock-chart-total">{kes(1016000)}</span>
          </div>
          <div className="hp-mock-bars">
            {[55, 70, 62, 88, 76, 100].map((h, i) => (
              <div className="hp-mock-bar-col" key={i}>
                <div className="hp-mock-bar" style={{ height: `${h}%` }} />
                <span className="hp-mock-bar-label">M{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="hp-mock-table">
          <div className="hp-mock-row head"><span>Tenant</span><span>Unit</span><span>Amount</span></div>
          {MOCK_PAYMENTS.map((p) => (
            <div className="hp-mock-row" key={p.name}>
              <span className="hp-mock-tenant"><strong>{p.name}</strong> <em>via {p.method}</em></span>
              <span>{p.unit}</span>
              <span className="hp-mock-amount">{kes(p.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MockStat({ label, value }) {
  return (
    <div className="hp-mock-stat">
      <span className="hp-mock-stat-label">{label}</span>
      <strong className="hp-mock-stat-value">{value}</strong>
    </div>
  );
}