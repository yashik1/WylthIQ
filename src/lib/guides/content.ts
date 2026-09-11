import type { MetricGuideId } from "../learn/metric-guide";

/**
 * Long-form guides, one page each.
 *
 * Written to be read, not to rank: each answers the question in its title
 * properly, with a worked example where numbers help, the limits of the idea
 * stated as plainly as its uses, and links to real company pages where the
 * idea can be seen applied. No ticker pages are generated from templates —
 * these are the only guide pages, and each one was written.
 *
 * Educational throughout. Nothing here says what to do with a company.
 */

export interface GuideSection {
  heading: string;
  paragraphs: string[];
  points?: string[];
}

export interface GuideExample {
  heading: string;
  rows: { label: string; value: string; emphasis?: boolean }[];
  note: string;
}

export interface Guide {
  slug: string;
  title: string;
  description: string;
  /** Words a reader might type into search to find this. */
  keywords: string[];
  standfirst: string;
  sections: GuideSection[];
  example?: GuideExample;
  /** Show the screener's presets, taken live from the screener. */
  presets?: boolean;
  apply: { label: string; href: string }[];
  related: MetricGuideId[];
  faq: { question: string; answer: string }[];
}

export const GUIDES: readonly Guide[] = [
  {
    slug: "how-to-analyze-a-company",
    title: "How to analyze a company's finances",
    description:
      "A step-by-step way to read any public company's financial statements: what it does, whether it makes money and cash, what it owes, how it is valued, and what changed.",
    keywords: ["analyze a company", "analyse a company", "fundamental analysis", "research a stock", "financial analysis", "company research"],
    standfirst:
      "A repeatable order for reading a public company's finances from its own filings. It will not tell you what to do about a company. It will tell you what the numbers say, and where to look when they disagree with each other.",
    sections: [
      {
        heading: "Start with what the business does",
        paragraphs: [
          "Every ratio means something different depending on the business behind it. A 5% profit margin is thin for a software company and ordinary for a grocer; heavy borrowing is normal for a utility and alarming for a retailer.",
          "In a US annual report, Form 10-K, the section headed Business describes what the company sells, to whom, and through which segments. Note whether revenue recurs — subscriptions, contracts, consumables — or depends on one-off sales, because that changes how much any single year can tell you.",
        ],
      },
      {
        heading: "Is it profitable?",
        paragraphs: [
          "Read the income statement from the top down. Revenue less the direct cost of sales is gross profit; less running costs, operating income; less interest and tax, net income. Each step has a margin: the share of each dollar of revenue that survives it.",
          "Look at several years rather than one. Net income moves with one-off items — an asset sale, a legal settlement, a change in tax law — so operating income is usually the steadier read on the business itself.",
        ],
        points: [
          "Gross margin reflects pricing power and the cost of inputs.",
          "Operating margin reflects how efficiently the business is run.",
          "Net margin is what is left for shareholders after everything else.",
        ],
      },
      {
        heading: "Is it growing?",
        paragraphs: [
          "Compare revenue with the year before, and with three years earlier to smooth out a single good or bad year. The notes to the financial statements say whether growth came from acquisitions, which add revenue without the original business growing.",
          "Growth on a shrinking margin can mean a company is discounting to win sales. Growth with a steady or rising margin is a different situation, and the two are worth telling apart.",
        ],
      },
      {
        heading: "Does profit turn into cash?",
        paragraphs: [
          "Profit is an accounting measure; cash is harder to flatter. Over time, operating cash flow from the cash flow statement should broadly keep pace with net income. When profit keeps running ahead of cash, the usual explanations are customers paying more slowly or inventory building up, and both show in the balance sheet.",
          "Free cash flow — operating cash flow less capital expenditure — is the cash left after maintaining and growing the business. It is what pays dividends, repurchases shares and repays debt.",
        ],
      },
      {
        heading: "How much does it owe?",
        paragraphs: [
          "Total liabilities include ordinary items such as unpaid supplier bills and payments customers made in advance, so they overstate what a company has borrowed. Net debt — borrowings less cash — and the years of operating cash flow it would take to repay it are more direct measures.",
          "Interest cover, operating income divided by interest expense, shows whether the business earns its interest bill comfortably. Banks and insurers are a separate case: borrowing is their raw material, so these measures do not read the same way for them.",
        ],
      },
      {
        heading: "How is it valued?",
        paragraphs: [
          "Valuation is a question about the share price, not about the business. Price to earnings, price to free cash flow and enterprise value to EBITDA each set the market's price against something the company produces.",
          "A multiple only means something against a comparison: the company's own history, or companies like it. A low multiple can reflect a business the market expects to shrink, and a high one a business expected to grow.",
        ],
      },
      {
        heading: "What changed, and what could go wrong?",
        paragraphs: [
          "Set the latest year beside the one before, and the latest quarter beside the same quarter a year earlier. Then read the risk factors and management's discussion of results, where the company explains the changes in its own words.",
          "Statistical screens help decide where to look harder. The Beneish M-Score flags accounting patterns associated with overstated earnings, and the Altman Z-Score describes how close a balance sheet looks to distress. Neither is a finding; both are prompts.",
        ],
      },
      {
        heading: "Write down what you think, and check it later",
        paragraphs: [
          "A written thesis — what has to go right, what would change your mind, and the figures that would show it — turns the next annual report into a check rather than a fresh opinion. It also makes it harder to rewrite the reasons afterwards.",
        ],
      },
    ],
    apply: [
      { label: "Follow these steps on Apple's page", href: "/stock/AAPL" },
      { label: "Screen for financially healthy companies", href: "/screen?preset=healthy" },
      { label: "Compare four large technology companies", href: "/compare?symbols=AAPL,MSFT,GOOGL,NVDA" },
    ],
    related: ["revenue", "operating-margin", "free-cash-flow", "net-debt", "pe", "health-score"],
    faq: [
      {
        question: "Do I need to read the whole annual report?",
        answer:
          "No. Most of what matters sits in four places: the description of the business, the three financial statements, the risk factors, and management's discussion of results. The notes are worth opening when a number looks unusual.",
      },
      {
        question: "What is the single most important number?",
        answer:
          "There is not one. The most informative starting points are pairs that can disagree with each other: profit against operating cash flow, and debt against the cash flow available to repay it.",
      },
      {
        question: "How often do the figures change?",
        answer:
          "US companies file an annual report once a year and a quarterly report for each of the other three quarters. The share price changes constantly, so valuation measures move every day while the underlying financial figures move each quarter.",
      },
    ],
  },
  {
    slug: "how-to-read-a-balance-sheet",
    title: "How to read a balance sheet",
    description:
      "What a balance sheet shows, what assets, liabilities and equity include, the ratios built from it, and what it cannot tell you — with a worked example.",
    keywords: ["balance sheet", "assets liabilities equity", "read a balance sheet", "statement of financial position", "working capital"],
    standfirst:
      "A balance sheet is a photograph of what a company owns and owes on a single day. Read well, it answers a question the income statement cannot: how much room the company has if things go wrong.",
    sections: [
      {
        heading: "One equation, one date",
        paragraphs: [
          "Every balance sheet obeys the same identity: assets equal liabilities plus shareholders' equity. Everything the company owns was paid for either by owing someone, or by its owners — through the money they put in and the profits the company kept.",
          "It describes one date, the end of the reporting period. A company can look quite different a few weeks later, and a year-end balance sheet can flatter a business whose cash peaks at that time of year.",
        ],
      },
      {
        heading: "Assets: what the company owns",
        paragraphs: [
          "Current assets are expected to turn into cash within a year: cash and equivalents, receivables — money customers owe — and inventory. Non-current assets last longer: property, plant and equipment, long-term investments, and intangible assets such as goodwill.",
        ],
        points: [
          "Receivables growing faster than revenue can mean customers are taking longer to pay.",
          "Inventory growing faster than sales can mean products are not moving.",
          "Goodwill is the premium paid for acquisitions above the value of what was acquired. It is written down, not sold, when a deal disappoints.",
        ],
      },
      {
        heading: "Liabilities: what it owes",
        paragraphs: [
          "Current liabilities fall due within a year: supplier bills, short-term borrowings, wages and taxes owed, and deferred revenue — cash customers have already paid for things not yet delivered. Non-current liabilities include long-term debt, leases and pension obligations.",
          "Not every liability is a loan. Deferred revenue in particular is often a sign of a healthy subscription business rather than a burden. That is why net debt — borrowings less cash — is a truer measure of indebtedness than total liabilities.",
        ],
      },
      {
        heading: "Equity: what belongs to shareholders",
        paragraphs: [
          "Equity is what remains after subtracting liabilities from assets. It is made up of the capital shareholders contributed and retained earnings, the profits kept rather than paid out.",
          "Equity can be negative without the company being in difficulty. A business that repurchases large amounts of its own shares reduces its equity with every repurchase, which is why some very profitable companies show negative equity and a debt-to-equity ratio that means little.",
        ],
      },
      {
        heading: "The ratios it supports",
        paragraphs: [
          "Several of the most common ratios come from the balance sheet alone, or from the balance sheet together with the income statement.",
        ],
        points: [
          "Current ratio: current assets divided by current liabilities. Below 1 means more falls due within a year than is readily available — something some businesses run on comfortably and others cannot.",
          "Debt to equity: liabilities divided by equity, how much of the company is funded by creditors rather than owners. WylthIQ's version uses total liabilities.",
          "Net debt: borrowings less cash. A negative figure means more cash than borrowings.",
          "Return on equity and return on assets: profit from the income statement, set against equity or assets from here.",
        ],
      },
      {
        heading: "What it cannot tell you",
        paragraphs: [
          "Assets are mostly recorded at what they cost, less depreciation, not at what they would fetch today. A brand, a customer base or a team of engineers rarely appears at all. Some obligations sit outside the balance sheet entirely and are only described in the notes.",
        ],
      },
    ],
    example: {
      heading: "A worked example",
      rows: [
        { label: "Cash", value: "$20m" },
        { label: "Receivables", value: "$15m" },
        { label: "Inventory", value: "$10m" },
        { label: "Current assets", value: "$45m", emphasis: true },
        { label: "Property, plant and equipment", value: "$55m" },
        { label: "Total assets", value: "$100m", emphasis: true },
        { label: "Supplier bills and other current liabilities", value: "$12m" },
        { label: "Short-term debt", value: "$8m" },
        { label: "Current liabilities", value: "$20m", emphasis: true },
        { label: "Long-term debt", value: "$30m" },
        { label: "Total liabilities", value: "$50m", emphasis: true },
        { label: "Shareholders' equity", value: "$50m", emphasis: true },
      ],
      note:
        "Assets of $100m equal liabilities of $50m plus equity of $50m. The current ratio is $45m ÷ $20m = 2.25, debt to equity is $50m ÷ $50m = 1.0, and net debt is $8m + $30m of borrowings less $20m of cash, or $18m.",
    },
    apply: [
      { label: "Apple's balance sheet in the statement explorer", href: "/stock/AAPL#statements" },
      { label: "Royal Bank of Canada, where leverage reads differently", href: "/stock/RY" },
      { label: "Screen for low debt to equity", href: "/screen?preset=quality" },
    ],
    related: ["current-ratio", "debt-to-equity", "net-debt", "roe"],
    faq: [
      {
        question: "Why can a company have negative equity?",
        answer:
          "Equity falls when a company repurchases its own shares or pays out more than it earns, and rises when it keeps profits. A business that has returned a great deal of cash through repurchases can end up with negative equity while remaining highly profitable. Losses over many years produce the same figure for a much less comfortable reason.",
      },
      {
        question: "Why do banks look so heavily indebted?",
        answer:
          "Customer deposits are liabilities, and lending those deposits out is the business. A bank's balance sheet is therefore mostly liabilities by design, and it is judged on regulatory capital ratios rather than on the ratios used for industrial companies.",
      },
      {
        question: "What is working capital?",
        answer:
          "Current assets less current liabilities. It is the cushion a company has for its day-to-day operations. Some businesses, such as retailers paid in cash before they pay suppliers, run with negative working capital quite comfortably.",
      },
    ],
  },
  {
    slug: "how-to-read-an-income-statement",
    title: "How to read an income statement",
    description:
      "How revenue becomes profit, line by line: gross, operating and net income, margins, earnings per share and one-off items — with a worked example.",
    keywords: ["income statement", "profit and loss", "p&l", "read an income statement", "gross profit", "operating income", "net income"],
    standfirst:
      "An income statement shows how much a company sold over a period and how much of it survived each layer of cost. Its structure is almost the same for every company, which makes it the easiest of the three statements to learn first.",
    sections: [
      {
        heading: "Revenue at the top",
        paragraphs: [
          "Revenue, also called sales or turnover, is everything customers paid for goods and services in the period. It is recognised when the company delivers what it promised, which is not always when the cash arrives.",
        ],
      },
      {
        heading: "Cost of revenue and gross profit",
        paragraphs: [
          "Cost of revenue is what it cost to produce what was sold: materials, manufacturing, hosting, the labour tied directly to delivery. Revenue less cost of revenue is gross profit, and gross profit divided by revenue is the gross margin.",
          "Gross margin is where pricing pressure tends to show first. A company forced to discount, or facing higher input costs it cannot pass on, usually sees it here before anywhere else.",
        ],
      },
      {
        heading: "Operating expenses and operating income",
        paragraphs: [
          "Operating expenses are the costs of running the business that are not tied to a single sale: selling, general and administrative costs, and research and development. Gross profit less operating expenses is operating income, often close to what is called EBIT.",
          "Operating margin is the clearest single read on how efficiently a business runs. It sits after the costs management controls and before interest and tax, which depend on how the company is financed and where it is taxed.",
        ],
      },
      {
        heading: "Interest, tax and net income",
        paragraphs: [
          "Interest expense, other income and tax come next, leaving net income: the profit attributable to shareholders. Net margin is net income divided by revenue.",
          "Net income is where one-off items land — a gain on selling a division, a write-down, a legal settlement, a change in tax law. A sharp move in net income beside a steady operating income usually means one of these, and the notes will name it.",
        ],
      },
      {
        heading: "Earnings per share",
        paragraphs: [
          "Earnings per share divides net income by the number of shares. Basic EPS uses the average number of shares outstanding through the period; diluted EPS adds the shares that options and convertible securities could create.",
          "EPS can rise while net income stays flat, because repurchasing shares shrinks the number it is divided by. Reading EPS beside the share count shows which is happening.",
        ],
      },
      {
        heading: "Reading it well",
        paragraphs: ["A few habits make an income statement much more informative than a single year's figures suggest."],
        points: [
          "Compare margins across several years rather than the level in one.",
          "Compare against similar companies, since margins vary enormously between industries.",
          "Treat adjusted figures in a press release as the company's own presentation. The income statement in the filing is the audited one.",
          "Compare a quarter with the same quarter a year earlier, because many businesses are seasonal.",
        ],
      },
    ],
    example: {
      heading: "A worked example",
      rows: [
        { label: "Revenue", value: "$1,000m", emphasis: true },
        { label: "Cost of revenue", value: "$600m" },
        { label: "Gross profit (40% margin)", value: "$400m", emphasis: true },
        { label: "Operating expenses", value: "$250m" },
        { label: "Operating income (15% margin)", value: "$150m", emphasis: true },
        { label: "Interest expense", value: "$20m" },
        { label: "Income before tax", value: "$130m" },
        { label: "Tax", value: "$26m" },
        { label: "Net income (10.4% margin)", value: "$104m", emphasis: true },
        { label: "Shares outstanding", value: "50m" },
        { label: "Earnings per share", value: "$2.08", emphasis: true },
      ],
      note:
        "Each margin is the line divided by revenue of $1,000m. Earnings per share is net income of $104m divided by 50m shares.",
    },
    apply: [
      { label: "Apple's income statement in the statement explorer", href: "/stock/AAPL#statements" },
      { label: "What changed in Apple's latest figures", href: "/stock/AAPL#what-changed" },
      { label: "Screen for high-margin companies", href: "/screen?preset=quality" },
    ],
    related: ["revenue", "gross-margin", "operating-margin", "net-margin", "eps"],
    faq: [
      {
        question: "What is EBITDA?",
        answer:
          "Earnings before interest, tax, depreciation and amortisation — roughly operating income with depreciation and amortisation added back. It approximates profit before the cost of long-lived assets, which is why it ignores capital spending entirely. It is not a line in audited statements, so companies calculate it in different ways.",
      },
      {
        question: "Why do margins differ so much between companies?",
        answer:
          "Because business models differ. A software company pays little to deliver one more copy of its product and can run a very high gross margin; a supermarket buys almost everything it sells and runs a thin one. Margins are most informative when compared within an industry or across one company's own history.",
      },
      {
        question: "Is a loss always a warning sign?",
        answer:
          "Not on its own. Young companies often lose money while they invest in growth. What matters is how long the losses are expected to last, how much cash the company holds, and whether the trend in its margins is improving.",
      },
    ],
  },
  {
    slug: "what-is-free-cash-flow",
    title: "What is free cash flow?",
    description:
      "Free cash flow is the cash a business generates after paying for its own upkeep and investment. How it is calculated, why it matters, and where it misleads.",
    keywords: ["free cash flow", "fcf", "cash flow", "operating cash flow", "capex", "capital expenditure", "p/fcf"],
    standfirst:
      "Free cash flow is the cash left over after a company has paid its running costs and invested in the equipment, buildings and systems it needs. It is the money that can pay dividends, repurchase shares or repay debt.",
    sections: [
      {
        heading: "How it is calculated",
        paragraphs: [
          "Free cash flow is operating cash flow less capital expenditure. Both come from the cash flow statement: operating cash flow is the cash generated by running the business, and capital expenditure — often labelled purchases of property, plant and equipment — is what was spent on long-lived assets.",
          "Companies disagree about the sign of capital expenditure in their structured data, since it is an outflow. WylthIQ always treats it as an amount spent, so a company that records it as a negative number is not mistakenly credited with extra cash.",
        ],
      },
      {
        heading: "Why it differs from profit",
        paragraphs: [
          "Net income includes items that are not cash, and misses cash that is not income. Depreciation reduces profit without any cash leaving; money tied up in unpaid invoices or unsold inventory reduces cash without touching profit; spending on a factory reduces cash at once but reaches profit only gradually, through depreciation.",
          "Over a long run the two should broadly agree. A company whose profit consistently exceeds its free cash flow merits a closer look at what is absorbing the cash.",
        ],
      },
      {
        heading: "What it is used for",
        paragraphs: ["Free cash flow sits behind several of the most useful comparisons between companies."],
        points: [
          "Free cash flow margin — free cash flow divided by revenue — shows how much of each sale becomes spare cash.",
          "Price to free cash flow — market value divided by free cash flow — sets the share price against that cash, and is harder to flatter than price to earnings.",
          "Dividend cover: comparing dividends paid with free cash flow shows whether a dividend is funded by the business or by borrowing.",
        ],
      },
      {
        heading: "Where it misleads",
        paragraphs: [
          "Capital spending is lumpy. A company building a new plant can show negative free cash flow for a year or two while it invests in growth, and a company cutting investment can flatter its free cash flow while storing up problems for later.",
          "Stock-based compensation is added back in operating cash flow because no cash changes hands, yet it dilutes existing shareholders. For companies that pay heavily in shares, free cash flow overstates the cash truly available to current owners.",
          "Operating cash flow can also be managed at the edges — by delaying payments to suppliers around the year end, for example — so a single year deserves less weight than the trend across several.",
        ],
      },
    ],
    example: {
      heading: "A worked example",
      rows: [
        { label: "Operating cash flow", value: "$180m" },
        { label: "Capital expenditure", value: "$60m" },
        { label: "Free cash flow", value: "$120m", emphasis: true },
        { label: "Revenue", value: "$1,000m" },
        { label: "Free cash flow margin", value: "12%", emphasis: true },
        { label: "Market value", value: "$2,400m" },
        { label: "Price to free cash flow", value: "20x", emphasis: true },
      ],
      note:
        "Free cash flow is $180m less $60m. The margin divides it by revenue of $1,000m, and price to free cash flow divides the market value of $2,400m by it.",
    },
    apply: [
      { label: "Apple's cash flow statement", href: "/stock/AAPL#statements" },
      { label: "Screen for quality companies", href: "/screen?preset=quality" },
      { label: "Screen for dividend payers", href: "/screen?preset=dividend" },
    ],
    related: ["free-cash-flow", "fcf-margin", "price-to-fcf"],
    faq: [
      {
        question: "Can a well-run company have negative free cash flow?",
        answer:
          "Yes, while it invests heavily ahead of growth. What matters is whether that investment earns a return over time, and how it is being funded in the meantime — from cash on hand, from borrowing, or from issuing shares.",
      },
      {
        question: "Is free cash flow the same as EBITDA?",
        answer:
          "No. EBITDA is an earnings measure that adds back depreciation and ignores capital spending, working capital, interest and tax. Free cash flow is cash actually generated after capital spending, which makes it the stricter of the two.",
      },
      {
        question: "Why can WylthIQ's figure differ from the company's own?",
        answer:
          "Companies often define free cash flow themselves in press releases — subtracting lease payments, or adding back particular items. WylthIQ uses the plain definition, operating cash flow less capital expenditure, taken from the filed statements.",
      },
    ],
  },
  {
    slug: "what-is-piotroski-f-score",
    title: "What is the Piotroski F-Score?",
    description:
      "Nine yes-or-no tests of whether a company's finances improved over the year, from a 2000 study by Joseph Piotroski. The tests, the scale, and its limits.",
    keywords: ["piotroski", "f-score", "f score", "fscore", "piotroski score"],
    standfirst:
      "The Piotroski F-Score adds up nine simple tests of a company's financial statements, each worth one point when passed. It answers a narrow question well: did the company's finances get stronger or weaker over the last year?",
    sections: [
      {
        heading: "Where it comes from",
        paragraphs: [
          "Joseph Piotroski, an accounting professor, published the score in 2000 in a study of companies trading at low prices relative to their book value. Within that group, he found that companies whose statements were improving went on to do markedly better than companies whose statements were deteriorating.",
          "Its appeal is simplicity. Every test uses figures from two consecutive annual reports, and none needs a share price.",
        ],
      },
      {
        heading: "The nine tests",
        paragraphs: [
          "The tests cover profitability, leverage and liquidity, and operating efficiency. WylthIQ applies each one as follows.",
        ],
        points: [
          "Profitable: net income is positive relative to assets.",
          "Positive cash flow: operating cash flow is above zero.",
          "Profitability improving: return on assets is higher than a year earlier.",
          "Profits backed by cash: operating cash flow exceeds net income.",
          "Debt not rising: long-term debt as a share of assets has not increased.",
          "Bills easier to pay: the current ratio is higher than a year earlier.",
          "No new shares issued: the share count has not grown by more than 2%, a margin that allows for routine employee share grants.",
          "Margins improving: gross margin is higher than a year earlier.",
          "Assets working harder: revenue divided by assets is higher than a year earlier.",
        ],
      },
      {
        heading: "Reading the score",
        paragraphs: [
          "Scores run from 0 to 9. On WylthIQ, a company passing at least 78% of the tests it could be scored on — 7 or more of 9 — is rated strong, at least 44% — 4 or more of 9 — mixed, and anything below that weak.",
          "When a company does not report a figure a test needs, that test is left out and the score is shown out of fewer than nine, rather than counted as a failure. A bank, which reports no current ratio, is scored out of eight.",
        ],
      },
      {
        heading: "What it does not tell you",
        paragraphs: ["The score is deliberately blunt, and its bluntness has costs."],
        points: [
          "It measures change, not level. An excellent business that had a slightly weaker year can score below a struggling one that improved a little.",
          "Every test is pass or fail, so a margin up by a hair counts the same as one up by ten points.",
          "It says nothing about valuation, and the original research concerned inexpensive, often small companies.",
          "Several tests fit industrial companies better than banks and insurers.",
        ],
      },
    ],
    apply: [
      { label: "Every F-Score check on Apple's page", href: "/stock/AAPL#health" },
      { label: "Screen for a minimum F-Score", href: "/screen?minFScore=7" },
      { label: "Screen for financial health", href: "/screen?preset=healthy" },
    ],
    related: ["piotroski", "roa", "current-ratio", "gross-margin", "share-count"],
    faq: [
      {
        question: "What counts as a high F-Score?",
        answer:
          "Seven to nine describes finances that improved on most measures over the year, and zero to three finances that deteriorated on most. Because the score measures change, a high score is most informative alongside the level of profitability and debt it started from.",
      },
      {
        question: "Why is a company scored out of eight rather than nine?",
        answer:
          "One of the nine tests needed a figure the company did not report. WylthIQ leaves that test out rather than counting it as failed, so the company is not marked down for a disclosure it never made.",
      },
      {
        question: "Does the F-Score predict share prices?",
        answer:
          "The original research found an association within a specific group of companies over a specific period. The score itself is a description of two sets of financial statements, not a forecast of what a share price will do.",
      },
    ],
  },
  {
    slug: "what-is-altman-z-score",
    title: "What is the Altman Z-Score?",
    description:
      "A model from 1968 that combines balance-sheet and income ratios to describe how close a company looks to financial distress. The formula, the zones and the variants.",
    keywords: ["altman", "z-score", "z score", "altman z", "bankruptcy prediction", "financial distress"],
    standfirst:
      "The Altman Z-Score blends several financial ratios into one number describing how closely a company's accounts resemble those of companies that went bankrupt. It is a statistical picture of a balance sheet, not a forecast that any particular company will fail.",
    sections: [
      {
        heading: "Where it comes from",
        paragraphs: [
          "Edward Altman, a finance professor, built the model in 1968. He compared manufacturing companies that had filed for bankruptcy with similar companies that had not, and found the combination of ratios that best separated the two groups.",
        ],
      },
      {
        heading: "The original formula",
        paragraphs: [
          "Z = 1.2 × working capital ÷ total assets + 1.4 × retained earnings ÷ total assets + 3.3 × operating income ÷ total assets + 0.6 × market value of equity ÷ total liabilities + 1.0 × revenue ÷ total assets.",
          "For this model a score above 2.99 is the safe zone, 1.81 to 2.99 the grey zone, and below 1.81 the distress zone.",
        ],
        points: [
          "Working capital to assets measures short-term liquidity.",
          "Retained earnings to assets measures accumulated profitability, and indirectly how long a company has been profitable.",
          "Operating income to assets measures current earning power.",
          "Market value to liabilities measures how far the value of the shares could fall before liabilities exceeded assets.",
          "Revenue to assets measures how hard the assets are working.",
        ],
      },
      {
        heading: "The variants WylthIQ uses",
        paragraphs: [
          "The original was fitted on manufacturers with a share price. Altman later published two revisions, and WylthIQ picks whichever of the three fits the company.",
        ],
        points: [
          "Z′, for manufacturers when no share price is available, uses book equity in place of market value, with weights of 0.717, 0.847, 3.107, 0.420 and 0.998. It is safe above 2.9 and in distress below 1.23.",
          "Z″, for non-manufacturers, drops the revenue-to-assets term, which varies too much between industries, and uses weights of 6.56, 3.26, 6.72 and 1.05. It is safe above 2.6 and in distress below 1.1.",
          "Banks and insurers get no Z-Score. Their balance sheets have no working capital to measure and are built on borrowing, so the model would call every healthy bank distressed.",
        ],
      },
      {
        heading: "What it does not tell you",
        paragraphs: ["A Z-Score is a useful prompt and a poor verdict."],
        points: [
          "It describes the shape of a balance sheet today. It was not designed to time a failure.",
          "Companies that repurchase many shares carry lower retained earnings and book equity, which pulls the book-value variant down without the business changing.",
          "It was fitted on data from decades ago and on particular kinds of company. A service business can sit in the grey zone for years quite comfortably.",
          "A grey or distress reading is a reason to read the debt notes and the cash position closely, not a conclusion in itself.",
        ],
      },
    ],
    apply: [
      { label: "Apple's Z-Score and the variant used", href: "/stock/AAPL#health" },
      { label: "Screen for companies showing red flags", href: "/screen?preset=red-flags" },
      { label: "Why some scores do not apply to banks", href: "/learn" },
    ],
    related: ["altman", "current-ratio", "net-debt", "debt-to-equity"],
    faq: [
      {
        question: "What does a distress-zone reading mean?",
        answer:
          "That the company's ratios resemble those of companies that went bankrupt in the data the model was built on. It is a prompt to look at when debt falls due, how much cash is held, and whether interest is comfortably covered. Many companies spend time in the distress zone and do not fail.",
      },
      {
        question: "Why is there no Z-Score for banks?",
        answer:
          "A bank's balance sheet has no split between short-term and long-term items, so there is no working capital to measure, and borrowing is the business itself. The model would read every healthy bank as distressed, so WylthIQ omits it for financial companies and says so.",
      },
      {
        question: "Why does the score differ from one website to another?",
        answer:
          "Sites use different variants, different definitions of the inputs — market or book value of equity, which measure of operating income — and figures from different dates. WylthIQ names the variant it used beside the score.",
      },
    ],
  },
  {
    slug: "what-is-beneish-m-score",
    title: "What is the Beneish M-Score?",
    description:
      "An eight-ratio model from 1999 that screens financial statements for patterns associated with overstated earnings. How it works, the −1.78 threshold, and why a flag is not proof.",
    keywords: ["beneish", "m-score", "m score", "mscore", "earnings manipulation", "accounting red flags"],
    standfirst:
      "The Beneish M-Score looks for accounting patterns that companies later found to have overstated their earnings tended to share. A high score is a reason to read the filings closely. It is never evidence that anything is wrong.",
    sections: [
      {
        heading: "Where it comes from",
        paragraphs: [
          "Messod Beneish, an accounting professor, published the model in 1999. He studied companies later found to have manipulated their earnings and compared their statements, in the years before discovery, with those of other companies.",
        ],
      },
      {
        heading: "The eight ratios",
        paragraphs: [
          "Each ratio compares this year with last year, so the model needs two consecutive annual reports.",
        ],
        points: [
          "Days' sales in receivables index: are customers taking longer to pay, relative to sales?",
          "Gross margin index: has the gross margin deteriorated?",
          "Asset quality index: has more of the asset base moved into long-term assets that are harder to value?",
          "Sales growth index: how fast did revenue grow? Rapid growth creates pressure to keep it going.",
          "Depreciation index: has the rate of depreciation slowed, which flatters profit?",
          "SG&A index: have selling, general and administrative costs risen relative to sales?",
          "Leverage index: has debt risen relative to assets?",
          "Total accruals to total assets: how much of profit is not backed by cash?",
        ],
      },
      {
        heading: "The formula and the threshold",
        paragraphs: [
          "M = −4.84 + 0.920 × receivables index + 0.528 × gross margin index + 0.404 × asset quality index + 0.892 × sales growth index + 0.115 × depreciation index − 0.172 × SG&A index + 4.679 × accruals − 0.327 × leverage index.",
          "WylthIQ flags a score above −1.78, the threshold commonly used with the eight-variable model. Below it, nothing unusual is flagged.",
        ],
      },
      {
        heading: "What it does not tell you",
        paragraphs: ["False positives are common, and every flag needs context."],
        points: [
          "Plenty of companies with straightforward accounts trip it. Fast growth, acquisitions and a changing mix of products all move these ratios for ordinary reasons.",
          "It was built on a particular set of cases, from a particular period.",
          "It does not suit banks and insurers, whose statements are structured differently, so WylthIQ does not compute it for them.",
          "A flag says where to look — receivables, accruals, capitalised costs — not what will be found there.",
        ],
      },
    ],
    apply: [
      { label: "Apple's M-Score on its scorecard", href: "/stock/AAPL#health" },
      { label: "Screen for red flags", href: "/screen?preset=red-flags" },
      { label: "Screen with accounting flags excluded", href: "/screen?excludeAccountingFlags=1" },
    ],
    related: ["beneish", "free-cash-flow", "gross-margin"],
    faq: [
      {
        question: "Does a flag mean a company is committing fraud?",
        answer:
          "No. A flag means its ratios resemble those of companies that overstated earnings in the original study. Many flagged companies have entirely ordinary explanations, such as rapid growth or a recent acquisition.",
      },
      {
        question: "What is worth checking after a flag?",
        answer:
          "Whether receivables are growing faster than revenue, whether operating cash flow keeps pace with net income, how revenue is recognised according to the notes, and whether the company recently changed auditors or restated earlier figures — both of which appear in its 8-K filings.",
      },
      {
        question: "Why is there no M-Score for some companies?",
        answer:
          "The model needs a set of figures from two consecutive annual reports, and some companies do not report every one of them. It is also not computed for banks and insurers, whose statements do not fit it.",
      },
    ],
  },
  {
    slug: "what-is-price-to-earnings",
    title: "What is the P/E ratio?",
    description:
      "Price to earnings compares a company's share price with its profit. How it is calculated, what a high or low P/E can reflect, and where it misleads.",
    keywords: ["p/e", "pe", "pe ratio", "price to earnings", "price earnings ratio", "earnings multiple", "valuation"],
    standfirst:
      "The price-to-earnings ratio says how many dollars the market is paying for each dollar of a company's yearly profit. It is the most widely quoted valuation measure, and one of the easiest to misread.",
    sections: [
      {
        heading: "How it is calculated",
        paragraphs: [
          "P/E is the share price divided by earnings per share — or, equivalently, the company's total market value divided by its net income. WylthIQ uses the second form, with net income from the latest annual report and market value from the latest share price.",
          "A P/E of 20 means the market values the company at twenty times one year's profit. Its inverse, earnings divided by price, is the earnings yield: a P/E of 20 is an earnings yield of 5%.",
        ],
      },
      {
        heading: "Trailing and forward",
        paragraphs: [
          "A trailing P/E uses profits already reported. A forward P/E uses estimates of next year's profit, which can turn out to be wrong. WylthIQ shows only the trailing figure, because it rests on audited numbers.",
        ],
      },
      {
        heading: "What a high or low P/E can reflect",
        paragraphs: [
          "None of these can be read from the number alone, which is why a P/E means little without a comparison: the company's own history, or similar companies in the same industry.",
        ],
        points: [
          "Expected growth: the market pays more for profits it expects to grow.",
          "Risk: uncertain or cyclical profits usually command a lower multiple.",
          "The point in a cycle: a P/E looks low at the top of a cycle, when earnings are unusually high, and high at the bottom.",
          "Accounting: one-off gains inflate earnings and shrink the P/E; one-off charges do the opposite.",
        ],
      },
      {
        heading: "Where it breaks down",
        paragraphs: [
          "A company that lost money has no meaningful P/E, and WylthIQ shows none rather than a negative figure. A company with barely positive profit can show a P/E in the hundreds, which says more about the tiny profit than about the price.",
          "Because net income is an accounting measure, price to free cash flow makes a useful cross-check. A company whose cash flow is much weaker than its profit will look less expensive on P/E than on cash.",
        ],
      },
    ],
    example: {
      heading: "A worked example",
      rows: [
        { label: "Share price", value: "$50.00" },
        { label: "Earnings per share", value: "$2.50" },
        { label: "P/E", value: "20x", emphasis: true },
        { label: "Earnings yield", value: "5%", emphasis: true },
      ],
      note:
        "$50.00 ÷ $2.50 = 20. A company with a market value of $10bn and net income of $500m has the same P/E of 20.",
    },
    apply: [
      { label: "Compare P/E across large technology companies", href: "/compare?symbols=AAPL,MSFT,GOOGL,NVDA" },
      { label: "Screen for value", href: "/screen?preset=cheap-profitable" },
      { label: "Apple's valuation figures", href: "/stock/AAPL#key-figures" },
    ],
    related: ["pe", "price-to-fcf", "eps", "ps"],
    faq: [
      {
        question: "Is there a good P/E ratio?",
        answer:
          "There is no universal figure. What is typical depends on expected growth, risk, the industry and interest rates. A P/E is most informative against the company's own history and against similar companies.",
      },
      {
        question: "Why does WylthIQ show no P/E for some companies?",
        answer:
          "Either the company made a loss in its latest annual report, so there is no profit to divide by, or no share price was available to calculate a market value.",
      },
      {
        question: "Does a low P/E mean a share is inexpensive?",
        answer:
          "Not necessarily. A low P/E often reflects expectations that profits will fall, or a business the market regards as risky. It describes a price relative to past profit, not whether that price is right.",
      },
    ],
  },
  {
    slug: "financial-health-stock-screener",
    title: "A stock screener built on financial health",
    description:
      "Screen US and Canadian companies on financial health, profitability, growth, debt and accounting quality, using scores computed from their SEC filings.",
    keywords: ["stock screener", "financial health screener", "screener", "quality screener", "dividend screener", "value screener"],
    standfirst:
      "Most screeners filter on price and momentum. WylthIQ's filters on what companies report in their filings — profitability, growth, debt, cash generation and accounting quality — and says what each screen can and cannot find.",
    presets: true,
    sections: [
      {
        heading: "What financial health means here",
        paragraphs: [
          "Each company's health score averages four questions answered from its latest annual report: is it profitable, is it growing, how much debt does it carry against its cash flow, and are there accounting red flags. Each is rated strong, mixed or weak, and anything without enough reported figures is left out rather than guessed.",
          "Valuation is deliberately kept out of the score. Whether a share price is high is a separate question, and the screener filters on it separately.",
        ],
      },
      {
        heading: "Where the figures come from",
        paragraphs: [
          "The scores are computed from SEC EDGAR filings on a schedule and stored, so a screen across hundreds of companies returns instantly without calling a data provider for each one. Every result links to its company page, and every figure there links to the filing it came from.",
          "Canadian companies appear when they are listed in the US and file with the SEC, as most large ones do.",
        ],
      },
      {
        heading: "Using a screen well",
        paragraphs: ["A screen narrows a universe down to a reading list. A few habits make that list more useful."],
        points: [
          "Start from a ready-made screen, then narrow by sector and listing: a margin threshold means something different in software than in retail.",
          "Open a few results rather than reading the table alone. Each company page shows why its figures are what they are.",
          "Save a screen and run it again after the next reporting season to see which companies have moved in or out.",
          "Treat every result as a starting point for reading, not as a list of conclusions.",
        ],
      },
      {
        heading: "What a screen cannot do",
        paragraphs: [
          "A screen only finds what its filters describe. It cannot see a new competitor, a lawsuit, a change of management or anything else that is not yet in the figures, and the annual figures it reads can be several months old.",
        ],
      },
    ],
    apply: [
      { label: "Open the screener", href: "/screen" },
      { label: "Financial health screen", href: "/screen?preset=healthy" },
      { label: "Quality screen", href: "/screen?preset=quality" },
    ],
    related: ["health-score", "piotroski", "altman", "beneish"],
    faq: [
      {
        question: "How often are the scores updated?",
        answer:
          "The scores are recomputed on a regular schedule from the latest filings. A company's figures change when it files a new annual report, while share prices, used only for valuation filters, are refreshed separately.",
      },
      {
        question: "Which companies does it cover?",
        answer:
          "US-listed companies in the screening universe, and Canadian companies that file with the SEC. Each company's page works for any SEC filer, including ones outside the screening universe.",
      },
      {
        question: "Can a screen be saved and run again?",
        answer:
          "Yes. Signed in, any combination of filters can be saved, renamed or copied, and each saved screen shows when it was last opened and how many companies it returned.",
      },
    ],
  },
];

export function findGuide(slug: string): Guide | null {
  return GUIDES.find((guide) => guide.slug === slug) ?? null;
}
