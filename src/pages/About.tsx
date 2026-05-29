import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../lib/useDocumentTitle';

/**
 * /about — short About section + FAQ. Two SEO purposes:
 *   1. Trust signal: tells journalists and skeptics who built this and why.
 *   2. FAQPage JSON-LD: lets Google show the Q&As directly under search results.
 *
 * The FAQs use <details>/<summary> so the markup is accessible and works
 * without JS. The same Q&A content is mirrored in the FAQPage schema below
 * (kept in sync via the FAQS array — single source of truth).
 */
interface FaqItem {
  q: string;
  a: string;
}

const FAQS: FaqItem[] = [
  {
    q: 'What is proportional representation?',
    a: 'Proportional representation (PR) means a party’s share of seats roughly matches its share of the vote. Today the U.S. House uses single-member districts, where the candidate with the most votes in each district wins outright and the runner-up’s voters get no representation. PR allocates each state’s seats by vote share: if a state votes 55% Democratic and 45% Republican, a 10-seat delegation would be 5 D + 5 R rather than (say) 8 D + 2 R.',
  },
  {
    q: 'Why does it matter for the U.S. House?',
    a: 'Single-member districts amplify small vote shifts into large seat shifts and let aggressive line-drawing turn a slim popular-vote loss into a comfortable seat-count win. PR neutralizes that: the seat count tracks the vote count, and the line-drawing process becomes irrelevant to the partisan outcome. The site shows, state by state, how big that distortion is right now.',
  },
  {
    q: 'Where does the data come from?',
    a: 'The 2024 baseline comes from the U.S. House Clerk’s official election statistics PDF. The generic-ballot polling average uses Silver Bulletin’s public polling database. Uncontested districts are imputed from The Downballot’s 2024 presidential-by-congressional-district vote totals. All sources are linked from the Methodology page.',
  },
  {
    q: 'Is this partisan?',
    a: 'No. Proportional representation is structural: it shifts seats toward whichever party is underrepresented in a given state, regardless of which one that is. The 2024 baseline shows distortions favoring Democrats in some states (notably blue states with one-sided delegations) and Republicans in others. The point is to make the structural cost of the current system visible, not to advocate for either party.',
  },
  {
    q: 'What’s the Sandbox view for?',
    a: 'The Sandbox is the interactive part of the site, a what-if calculator. The Current and 2024 Retrospective views each show one computed outcome; the Sandbox lets you change the assumptions and watch every state’s projected delegation, the national totals, and the map all recompute on the fly. Four knobs: a hypothetical generic-ballot slider (from R+15 to D+15), up to three minor parties (preset coalitions or fully custom), an allocation method (Pure PR, multi-member districts, or mixed-member proportional — with sliders to fine-tune district size and the single-member share), and the size of the House (435, the Wyoming Rule at ~573, the cube root at ~692, or a custom number). If you’d rather see a reform than build one, a row of one-click Quick scenarios sets several knobs at once. A comparison table at the bottom shows national seat totals under every allocation method side-by-side. Every Sandbox setting is captured in the URL, so any scenario you build is a sharable link.',
  },
  {
    q: 'Can I see what would happen with a third or fourth party?',
    a: 'Yes. The Sandbox view (the third button in the mode toggle) lets you add up to three minor parties on top of D and R. Two are preset coalitions: Progressive Left (a Bernie/AOC-style breakaway, draws mostly from Democrats) and America First (a Trump/MAGA-style breakaway, draws mostly from Republicans). The third slot is fully custom: you pick the name, color, draw ratio between D and R, and national vote share. A per-state threshold slider (defaults to 5%, matching real PR systems) sets the minimum vote share a party needs to win any seats. The map then shows each state’s plurality party, with diagonal stripes overlaying when a third party wins seats but a major still leads. This is a client-side what-if tool; the Current and Retrospective views, the public data API, and downloadable CSV/JSON stay strictly two-party.',
  },
  {
    q: 'What’s the difference between Pure PR, MMD, and MMP?',
    a: 'They’re three points on the proportionality spectrum between today’s single-member districts and pure statewide PR. Quick decoder for the names: in MMD-3 and MMD-5, the number is the district size in seats; in MMP-50, the number is the percentage of seats that come from single-member districts (so MMP-50 means 50% SMD plus 50% list). Pure PR allocates every state’s seats by total statewide vote share, the most proportional of the four. Multi-member districts (MMD) chop each state into smaller districts of N seats and run PR within each; smaller districts mean less proportionality (a 3-seat district can only really represent two parties; a 5-seat district can fit a third party that clears ~17% of the local vote), so MMD-3 sits closer to today’s SMD outcome while MMD-5 sits closer to Pure PR. Real-world precedent: Ireland uses 3–5 seat STV districts; the Illinois House used 3-seat cumulative voting from 1870 to 1980. Mixed-member proportional (MMP-50) keeps half the seats as single-member districts (using today’s actual delegation as the proxy) and fills the other half with proportional list seats that top each party up to its target. Your congressperson is still elected from your district, with the list seats added on top for proportionality. Germany, New Zealand, Scotland, and Wales all use MMP. The Sandbox method picker lets you toggle between all four, and the comparison table shows totals for every method side-by-side. MMD’s district size (2–10 seats) and MMP’s single-member share (10–90%) are both adjustable with a slider, so MMD-3, MMD-5, and MMP-50 are just the common presets rather than the only options. The Methodology page has more on each model’s caveats.',
  },
  {
    q: 'Why are there multiple PR formulas (Sainte-Laguë, D’Hondt, Hamilton)?',
    a: '“PR” is a family of methods, not one method. Sainte-Laguë (our default) is the most neutral: it neither favors nor penalizes large parties, and is used in Germany, New Zealand, Sweden, and Norway. D’Hondt slightly favors larger parties (used in Spain, Portugal, Belgium, the European Parliament); in a tight 12-seat state at 55/45 a D’Hondt split might be 8-4 where Sainte-Laguë would be 7-5. Hamilton (also called Largest Remainder) is genuinely proportional in the average case but has known mathematical paradoxes, most famously the Alabama paradox, where adding a seat to the legislature can paradoxically cost a state a seat. The US Congress actually used Hamilton for state apportionment until the 1880 census produced paradoxical results; Huntington-Hill replaced it federally in 1941. The Sandbox lets you toggle between all three to see how the formula choice shifts the result by 1–3 seats per state.',
  },
  {
    q: 'Why is the House 435 seats?',
    a: 'The number isn’t in the Constitution. The Permanent Apportionment Act of 1929 froze the House at 435 after the politically toxic 1920 reapportionment fight; the House actually skipped reapportionment that decade entirely, the only time in US history, because the urban/rural shift threatened too many incumbents. Before 1929, the House grew with the population. Two prominent expansion proposals: the Wyoming Rule (cap district population at the smallest state’s, putting the House at ~573 today) and the cube root rule (House size ≈ ∛population, ~692 today). The Sandbox House-size slider lets you toggle through both presets or set a custom size; seats reapportion among states via Huntington-Hill, the same method the real US House uses. The comparison table shows how each allocation method behaves under expansion. The actual-today row stays at 435 (it’s still the real House) while the reform rows reflect your chosen size. When the House is expanded, the “difference vs. today” is measured against today’s delegation scaled to the new size, so the extra seats aren’t mistaken for a partisan swing. The Methodology page has the math and the historical context.',
  },
  {
    q: 'Does expanding the House favor one party?',
    a: 'Not by itself. A bigger chamber gives every party more seats in raw terms, so it’s tempting to read a large “projected minus today” number as a partisan windfall — but at, say, 573 seats both parties gain seats. To avoid that confusion, the site measures every “vs. today” comparison against today’s delegation scaled to the chosen House size, which isolates the proportional shift from the pure growth in the number of seats. Expansion mostly makes outcomes more proportional (smaller districts, a smaller small-state bonus); whether that nets out toward either party depends on the allocation method and the current map, not on the seat count alone.',
  },
  {
    q: 'Why the House and not the Senate?',
    a: 'The Senate gives every state two senators regardless of population. That’s a fixed feature of the Constitution that can’t be changed without a constitutional amendment. The House is allocated proportionally by population already; the gap between current single-member-district allocation and full PR is a statutory choice, not a constitutional one. So the House is the realistic surface where PR could happen.',
  },
  {
    q: 'How are states with only one seat handled?',
    a: 'There’s no proportional way to split a single seat between two parties; whoever wins the statewide vote gets it. Seven states have a single House seat: Alaska, Delaware, North Dakota, South Dakota, Vermont, Wyoming, and (after the 2020 reapportionment) Montana shifted up to 2. For these states the projection just records the winner.',
  },
  {
    q: 'How often is the projection updated?',
    a: 'A scheduled job re-runs the pipeline nightly, pulling fresh polling data and recomputing every state’s projection. The “Last updated” timestamp in the footer shows when. If it’s been more than 48 hours, a banner appears across the top of the site.',
  },
  {
    q: 'Can I share or cite this?',
    a: 'Yes. Every page is shareable, and each state has its own URL (e.g., /state/tx) with a brand social-share preview. Cite as: “The Proportional House (proportionalhouse.org), accessed [date].” Source code is on GitHub if you want to dig into the pipeline.',
  },
];

export function About() {
  useDocumentTitle(
    'About · The Proportional House',
    'About The Proportional House: a non-partisan visualization of how the U.S. House would look under proportional representation. Plus a FAQ on the methodology and politics.',
    '/about',
  );

  // FAQPage JSON-LD. Mirror of the FAQS array — Google parses the Question
  // and acceptedAnswer fields directly.
  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQS.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: {
        '@type': 'Answer',
        text: f.a,
      },
    })),
  };

  return (
    <article className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="font-serif text-3xl sm:text-4xl font-medium text-brand-navy tracking-tight">
        About
      </h1>

      <section className="mt-5 text-stone-800 leading-relaxed space-y-4">
        <p>
          <strong>The Proportional House</strong> is a non-partisan visualization of what
          the U.S. House of Representatives would look like if every state allocated its
          seats by proportional representation rather than by single-member districts.
        </p>
        <p>
          The math is intentionally simple: take each state’s two-party House vote share,
          shift it by the difference between today’s generic-ballot polling and the 2024
          national House margin (scaled by a state-specific elasticity), then allocate
          that state’s seats by the Sainte-Laguë method. No swing-state magic, no
          district-by-district modeling, no partisan thumbs on the scale. Full details
          live on the{' '}
          <Link to="/methodology" className="underline hover:text-brand-navy">
            Methodology
          </Link>{' '}
          page.
        </p>
        <p>
          The point isn’t to predict the next election. It’s to make the structural
          cost of the current system visible, state by state. The <Link to="/rankings" className="underline hover:text-brand-navy">rankings</Link>{' '}
          page surfaces which delegations are most distorted today, and which states
          would shift the most under proportional allocation.
        </p>
        <p className="text-sm text-stone-600 pt-2 border-t border-stone-200/60">
          Built by{' '}
          <a
            href="https://axelhufford.com"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-brand-navy"
          >
            Axel Hufford
          </a>
          . Source code on{' '}
          <a
            href="https://github.com/axelhufford/the-proportional-house"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-brand-navy"
          >
            GitHub
          </a>
          .
        </p>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl text-brand-navy tracking-tight">
          Frequently asked questions
        </h2>
        <div className="mt-4 space-y-2">
          {FAQS.map((faq, i) => (
            <details
              key={i}
              className="group border border-stone-200 rounded-lg bg-white open:shadow-sm"
            >
              <summary className="cursor-pointer list-none px-4 py-3 flex items-center justify-between gap-3 font-medium text-stone-900 hover:bg-stone-50 rounded-lg">
                <span>{faq.q}</span>
                <span
                  aria-hidden="true"
                  className="text-stone-400 transition-transform group-open:rotate-45 text-xl leading-none"
                >
                  +
                </span>
              </summary>
              <div className="px-4 pb-4 text-stone-700 leading-relaxed text-sm">
                {faq.a}
              </div>
            </details>
          ))}
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
    </article>
  );
}
