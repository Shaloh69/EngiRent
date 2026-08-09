import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { CatalogueItem } from "../../types";

/**
 * "Browse gear" — mandate §4.
 *
 * A shelf of what students nearby have actually listed. This is the most
 * directly promotional screen on the kiosk: the abstract pitch ("rent gear
 * from other students") lands very differently when someone can see a
 * ₱20/day lab gown sitting two metres away.
 *
 * Read-only by design. Renting is initiated from the phone app — the kiosk
 * has no login and no payment surface, and adding one here would mean
 * handling credentials on a shared public terminal.
 */

const CATEGORY_LABEL: Record<string, string> = {
  SCHOOL_ATTIRE: "School Attire",
  ACADEMIC_TOOLS: "Academic Tools",
  ELECTRONICS: "Electronics",
  DEVELOPMENT_KITS: "Development Kits",
  MEASUREMENT_TOOLS: "Measurement Tools",
  AUDIO_VISUAL: "Audio/Visual",
  SPORTS_EQUIPMENT: "Sports Equipment",
  OTHER: "Other",
};

const DEMO_ITEMS: CatalogueItem[] = [
  { id: "1", title: "Casio FX-991ES Plus Scientific Calculator", category: "ACADEMIC_TOOLS", pricePerDay: 15, securityDeposit: 400 },
  { id: "2", title: "Arduino Uno R3 Starter Kit", category: "DEVELOPMENT_KITS", pricePerDay: 50, securityDeposit: 1200 },
  { id: "3", title: "Lab Gown (Medium)", category: "SCHOOL_ATTIRE", pricePerDay: 20, securityDeposit: 200 },
  { id: "4", title: "Anker 20000mAh Power Bank", category: "ELECTRONICS", pricePerDay: 30, securityDeposit: 800 },
  { id: "5", title: "Digital Vernier Caliper 150mm", category: "MEASUREMENT_TOOLS", pricePerDay: 25, securityDeposit: 600 },
  { id: "6", title: "Fluke 117 Digital Multimeter", category: "MEASUREMENT_TOOLS", pricePerDay: 60, securityDeposit: 2000 },
];

export function CatalogueScreen({ onBack, isDemo }: { onBack: () => void; isDemo: boolean }) {
  const [items, setItems] = useState<CatalogueItem[] | null>(isDemo ? DEMO_ITEMS : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    fetch("/api/catalogue")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        const rows = (d.items ?? []) as CatalogueItem[];
        setItems(rows);
        if (rows.length === 0) setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isDemo]);

  return (
    <div className="screen screen-info">
      <header className="info-head">
        <button type="button" className="info-back" onClick={onBack}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M9 5 4 12l5 7M4 12h16" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <div className="info-head-text">
          <p className="info-eyebrow">Available now</p>
          <h1 className="info-title">Gear other students have listed</h1>
        </div>
      </header>

      <p className="info-lede">
        Rent it for the weeks you actually need it instead of buying it for one
        subject. Book from the EngiRent app; collect from this locker.
      </p>

      <div className="info-scroll">
        {items === null ? (
          <div className="cat-grid">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="cat-card cat-skeleton" />
            ))}
          </div>
        ) : items.length === 0 || failed ? (
          <div className="info-empty">
            <p className="info-empty-title">Catalogue unavailable</p>
            <p>
              The kiosk can't reach the listing service right now. Everything
              else on this machine still works — open the EngiRent app to
              browse.
            </p>
          </div>
        ) : (
          <div className="cat-grid">
            {items.map((item, i) => (
              <motion.article
                key={item.id}
                className="cat-card"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 + i * 0.05, duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="cat-thumb">
                  {item.images && item.images.length > 0 ? (
                    <img src={item.images[0]} alt="" loading="lazy" />
                  ) : (
                    <span className="cat-thumb-fallback">
                      {(item.title ?? "?").slice(0, 1)}
                    </span>
                  )}
                </div>
                <div className="cat-body">
                  <p className="cat-cat">
                    {CATEGORY_LABEL[item.category ?? "OTHER"] ?? item.category}
                  </p>
                  <h2 className="cat-title">{item.title}</h2>
                  <div className="cat-price">
                    <span className="cat-rate">₱{Math.round(item.pricePerDay ?? 0)}</span>
                    <span className="cat-per">/day</span>
                  </div>
                  <p className="cat-dep">
                    ₱{Math.round(item.securityDeposit ?? 0)} deposit, refunded
                  </p>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>

      <footer className="info-foot">
        <span>Prices are set by the student who owns the item.</span>
        <button type="button" className="info-cta" onClick={onBack}>
          Back to the code
        </button>
      </footer>
    </div>
  );
}
