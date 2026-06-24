// ---------------------------------------------------------------------------
// kb-cockpit — exo.js
// Pure exoplanet "detectability" derivations (no DOM, ES module).
// Each derived quantity coalesces the DB value when present, else computes it
// from first principles, and is returned as { value, unit, derived, note } so
// the UI can flag derived numbers and surface the assumptions — keeping the
// showcase honest (matches the KB's provenance ethos).
//
// References:
//   Kempton et al. 2018 (PASP 130, 114401) — TSM / ESM transmission & emission
//   spectroscopy metrics.  Constants below follow that paper's scale factors.
// ---------------------------------------------------------------------------

// ---- SI / astrophysical constants ----
export const C = {
  G: 6.674e-11,           // m^3 kg^-1 s^-2
  kB: 1.380649e-23,       // J/K
  mH: 1.6726e-27,         // kg (H atom)
  sigma: 5.670374e-8,     // W m^-2 K^-4 (Stefan-Boltzmann)
  hP: 6.62607e-34,        // J s
  cLight: 2.99792e8,      // m/s
  R_earth: 6.371e6,       // m
  M_earth: 5.972e24,      // kg
  R_jup: 7.1492e7,        // m  (equatorial)
  M_jup: 1.898e27,        // kg
  R_sun: 6.957e8,         // m
  M_sun: 1.989e30,        // kg
  L_sun: 3.828e26,        // W
  T_sun: 5772,            // K
  AU: 1.495978707e11,     // m
  DAY: 86400,             // s
};

const num = v => (typeof v === "number" && isFinite(v)) ? v : null;

// Mean molecular weight (in units of m_H) assumed by atmospheric regime.
// H2-dominated for giants / sub-Neptunes / hycean; heavier for terrestrials.
function muForRegime(regime) {
  const r = (regime || "").toLowerCase();
  if (/jupiter|saturn|neptune|hycean|gas|giant/.test(r)) return { mu: 2.3, kind: "H₂/He" };
  if (/super-?earth/.test(r)) return { mu: 18, kind: "H₂O/CO₂ (assumed)" };
  if (/terrestrial|rocky|earth|mars|venus|sub-?earth/.test(r)) return { mu: 29, kind: "N₂/CO₂ (assumed)" };
  return { mu: 2.3, kind: "H₂/He (default)" };
}

// Bond albedo assumed by regime (for equilibrium-temperature fallback).
function albedoForRegime(regime) {
  const r = (regime || "").toLowerCase();
  if (/jupiter|saturn|hot/.test(r)) return 0.1;
  return 0.3;
}

const D = (value, unit, derived, note) => ({ value: num(value), unit, derived: !!derived, note: note || "" });

// --- individual derivations (each returns a D(...) record) ---

// Semi-major axis a [AU]: DB value else Kepler's 3rd law from period + stellar mass.
export function semiMajorAxis(p, s) {
  if (num(p.semi_major_axis_au) != null) return D(p.semi_major_axis_au, "AU", false);
  const P = num(p.orbital_period_days), Ms = num(s && s.mass_msun);
  if (P == null || Ms == null) return D(null, "AU", true, "needs period + stellar mass");
  const a = Math.cbrt(C.G * (Ms * C.M_sun) * Math.pow(P * C.DAY, 2) / (4 * Math.PI ** 2));
  return D(a / C.AU, "AU", true, "Kepler P²∝a³");
}

// Surface gravity g [m/s²] from planet mass + radius.
export function gravity(p) {
  if (num(p.gravity_ms2) != null) return D(p.gravity_ms2, "m/s²", false);
  const M = num(p.mass_mearth), R = num(p.radius_rearth);
  if (M == null || R == null) return D(null, "m/s²", true, "needs mass + radius");
  return D(C.G * (M * C.M_earth) / Math.pow(R * C.R_earth, 2), "m/s²", true);
}

// Stellar luminosity [L_sun] from R*, Teff.
export function luminosity(s) {
  const R = num(s && s.radius_rsun), T = num(s && s.teff_k);
  if (R == null || T == null) return D(null, "L⊙", true, "needs R*, Teff");
  const L = 4 * Math.PI * Math.pow(R * C.R_sun, 2) * C.sigma * Math.pow(T, 4);
  return D(L / C.L_sun, "L⊙", true);
}

// Insolation [S_earth] = L / (4π a²), normalised to Earth.
export function insolation(p, s) {
  const L = luminosity(s).value, a = semiMajorAxis(p, s).value;
  if (L == null || a == null) return D(null, "S⊕", true, "needs L*, a");
  return D(L / (a * a), "S⊕", true); // L in L_sun, a in AU → S in S_earth
}

// Equilibrium temperature [K]: DB value else from Teff, R*, a, albedo.
export function eqTemp(p, s) {
  if (num(p.equilibrium_temp_k) != null) return D(p.equilibrium_temp_k, "K", false);
  const T = num(s && s.teff_k), R = num(s && s.radius_rsun), a = semiMajorAxis(p, s).value;
  if (T == null || R == null || a == null) return D(null, "K", true, "needs Teff, R*, a");
  const Ab = albedoForRegime(p.regime_class);
  const Teq = T * Math.sqrt((R * C.R_sun) / (2 * a * C.AU)) * Math.pow(1 - Ab, 0.25);
  return D(Teq, "K", true, `A_B=${Ab}`);
}

// Atmospheric scale height H [km]: kB·Teq / (μ·mH·g).
export function scaleHeight(p, s) {
  if (num(p.scale_height_km) != null) return D(p.scale_height_km, "km", false);
  const g = gravity(p).value, Teq = eqTemp(p, s).value;
  if (g == null || Teq == null) return D(null, "km", true, "needs g, T_eq");
  const { mu, kind } = muForRegime(p.regime_class);
  const H = C.kB * Teq / (mu * C.mH * g);
  return D(H / 1000, "km", true, `μ≈${mu} (${kind})`);
}

// Transit depth δ = (Rp/R*)² [ppm].
export function transitDepth(p, s) {
  const Rp = num(p.radius_rearth), Rs = num(s && s.radius_rsun);
  if (Rp == null || Rs == null) return D(null, "ppm", true, "needs Rp, R*");
  const ratio = (Rp * C.R_earth) / (Rs * C.R_sun);
  return D(ratio * ratio * 1e6, "ppm", true);
}

// Transmission signal of the atmospheric annulus ΔD ≈ 2·N·Rp·H / R*² [ppm].
// N = number of scale heights probed (~7 is a common choice).
export function transmissionSignal(p, s, N = 7) {
  const Rp = num(p.radius_rearth), Rs = num(s && s.radius_rsun), H = scaleHeight(p, s).value;
  if (Rp == null || Rs == null || H == null) return D(null, "ppm", true, "needs Rp, R*, H");
  const dD = 2 * N * (Rp * C.R_earth) * (H * 1000) / Math.pow(Rs * C.R_sun, 2);
  return D(dD * 1e6, "ppm", true, `N=${N} scale heights`);
}

// Transmission Spectroscopy Metric (Kempton et al. 2018, Eq. 1).
// TSM = scale · (Rp³ · Teq) / (Mp · R*²) · 10^(-mJ/5), with Rp,Mp in Earth units
// and R* in SOLAR radii (the Table-1 scale factor absorbs the unit normalisation).
// NOTE: Kempton uses J-band; the catalog only carries K-band, used here as a proxy.
export function tsm(p, s) {
  const Rp = num(p.radius_rearth), Mp = num(p.mass_mearth),
        Rs = num(s && s.radius_rsun), mK = num(s && s.magnitude_k),
        Teq = eqTemp(p, s).value;
  if ([Rp, Mp, Rs, mK, Teq].some(v => v == null)) return D(null, "", true, "needs Rp,Mp,R*,mK,Teq");
  // scale factor by planet radius bin (Kempton 2018 Table 1)
  const scale = Rp < 1.5 ? 0.190 : Rp < 2.75 ? 1.26 : Rp < 4.0 ? 1.28 : 1.15;
  const val = scale * (Math.pow(Rp, 3) * Teq) / (Mp * Math.pow(Rs, 2)) * Math.pow(10, -mK / 5);
  return D(val, "", true, "Kempton+2018 (K-band proxy for J)");
}

// Emission Spectroscopy Metric (Kempton et al. 2018, Eq. 4) at 7.5 µm.
// ESM = 4.29e6 · (B(Tday,λ)/B(Tstar,λ)) · (Rp/R*)² · 10^(-mK/5), Tday ≈ 1.10·Teq.
export function esm(p, s) {
  const Rp = num(p.radius_rearth), Rs = num(s && s.radius_rsun),
        mK = num(s && s.magnitude_k), Ts = num(s && s.teff_k),
        Teq = eqTemp(p, s).value;
  if ([Rp, Rs, mK, Ts, Teq].some(v => v == null)) return D(null, "", true, "needs Rp,R*,mK,Teff,Teq");
  const lambda = 7.5e-6;
  const planck = (T) => 1 / (Math.exp(C.hP * C.cLight / (lambda * C.kB * T)) - 1); // ∝ B_λ
  const Tday = 1.10 * Teq;
  const ratioRp = (Rp * C.R_earth) / (Rs * C.R_sun);
  const val = 4.29e6 * (planck(Tday) / planck(Ts)) * ratioRp * ratioRp * Math.pow(10, -mK / 5);
  return D(val, "", true, "Kempton+2018, 7.5µm");
}

// Escape velocity [km/s] (context metric, ported from the MATLAB tool).
export function escapeVelocity(p) {
  const M = num(p.mass_mearth), R = num(p.radius_rearth);
  if (M == null || R == null) return D(null, "km/s", true, "needs mass + radius");
  return D(Math.sqrt(2 * C.G * (M * C.M_earth) / (R * C.R_earth)) / 1000, "km/s", true);
}

// Bulk density [g/cm³]: DB value else from mass + radius.
export function density(p) {
  if (num(p.density_gcc) != null) return D(p.density_gcc, "g/cm³", false);
  const M = num(p.mass_mearth), R = num(p.radius_rearth);
  if (M == null || R == null) return D(null, "g/cm³", true, "needs mass + radius");
  const vol = (4 / 3) * Math.PI * Math.pow(R * C.R_earth * 100, 3); // cm³
  return D((M * C.M_earth * 1000) / vol, "g/cm³", true);
}

// Convenience: everything at once.
export function deriveAll(p, s) {
  return {
    semiMajorAxis: semiMajorAxis(p, s),
    gravity: gravity(p),
    luminosity: luminosity(s),
    insolation: insolation(p, s),
    eqTemp: eqTemp(p, s),
    scaleHeight: scaleHeight(p, s),
    transitDepth: transitDepth(p, s),
    transmissionSignal: transmissionSignal(p, s),
    tsm: tsm(p, s),
    esm: esm(p, s),
    escapeVelocity: escapeVelocity(p),
    density: density(p),
  };
}
