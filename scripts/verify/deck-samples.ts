/**
 * Decks for different audiences and purposes, written the way the slides skill asks a model to write them (brief,
 * archetype, a message per slide, varied layouts), so their designs can be compared: each should look purpose-built.
 * Used by scripts/verify/office-files.ts.
 */
import { kinetraRecipes } from "../../desktop/kinetra-recipes.ts";

const circuit = kinetraRecipes.find((r) => r.name === "circuit schematic")!.figure;

export const deckSamples: Record<string, any> = {
  "lecture-photosynthesis": {
    title: "Photosynthesis: how plants turn light into sugar", subtitle: "Biology 201 · Week 4", author: "Dr. Amira Hassan",
    archetype: "lecture", brief: { audience: "second-year biology undergraduates", purpose: "teach the light and dark reactions", minutes: 50 },
    plan: ["Learning objectives", "Why photosynthesis matters", "The overall equation", "Light-dependent reactions", "The Calvin cycle", "Limiting factors", "Check your understanding", "Summary"],
    slides: [
      { layout: "title", kicker: "Biology 201" },
      { layout: "agenda", title: "Learning objectives", items: ["Write the overall equation and balance it", "Explain where light energy is captured", "Trace carbon through the Calvin cycle", "Predict the effect of limiting factors"] },
      { layout: "big-number", title: "Why photosynthesis matters", value: "~120 Gt", label: "of carbon fixed by plants every year", text: "Almost all the energy in food chains, and most of the oxygen we breathe, started here.", notes: "Ask the room where the carbon in their breakfast came from." },
      { layout: "equation", title: "Light energy builds glucose from carbon dioxide and water", math: "6\\,CO_2 + 6\\,H_2O \\xrightarrow{\\text{light}} C_6H_{12}O_6 + 6\\,O_2", bullets: ["Carbon is reduced; water is oxidised", "Oxygen is a by-product of splitting water"] },
      { layout: "section", title: "The light-dependent reactions", subtitle: "Thylakoid membranes" },
      { layout: "process", title: "Light energy becomes chemical energy in four steps", steps: [{ title: "Absorb", text: "Chlorophyll in photosystem II absorbs photons." }, { title: "Split water", text: "Electrons are replaced; O₂ is released." }, { title: "Pump protons", text: "The electron transport chain builds a gradient." }, { title: "Make ATP & NADPH", text: "ATP synthase and photosystem I store the energy." }], notes: "Draw the membrane on the board as you go." },
      { layout: "diagram", title: "The Calvin cycle fixes carbon in three stages", diagram: { type: "cycle", center: "Calvin cycle", items: [{ title: "Fixation", text: "Rubisco attaches CO₂ to RuBP." }, { title: "Reduction", text: "ATP and NADPH turn 3-PGA into G3P." }, { title: "Regeneration", text: "Most G3P rebuilds RuBP so the cycle continues." }] } },
      { layout: "chart", title: "Rate rises with light intensity until another factor limits it", chart: { type: "line", labels: ["0", "200", "400", "600", "800", "1000"], series: [{ name: "Low CO₂", values: [0, 6, 9, 10, 10, 10] }, { name: "High CO₂", values: [0, 7, 13, 17, 19, 20] }], unit: "µmol O₂ m⁻² s⁻¹" }, takeaway: "Raising CO₂ only helps once light is no longer limiting." },
      { layout: "statement", kicker: "Check your understanding", statement: "If you double the light on a plant that is CO₂-limited, what happens to the rate, and why?", text: "Two minutes with your neighbour, then we compare answers." },
      { layout: "icons", title: "Three ideas to take away", items: [{ icon: "sun", title: "Light is captured", text: "Photosystems turn photons into ATP and NADPH." }, { icon: "cycle", title: "Carbon is fixed", text: "The Calvin cycle builds sugar from CO₂." }, { icon: "growth", title: "Limits interact", text: "The scarcest factor sets the rate." }] },
      { layout: "closing", title: "Next week: cellular respiration", subtitle: "Read chapter 9 before the lecture" },
    ],
  },
  "pitch-loop": {
    title: "Loop: reusable packaging for food delivery", subtitle: "Seed round · 2026", author: "Loop Packaging Ltd",
    archetype: "pitch", brief: { audience: "seed investors", purpose: "raise $2.5M", tone: "bold, confident", minutes: 12 },
    slides: [
      { layout: "title", kicker: "Seed round" },
      { layout: "big-number", value: "41B", label: "single-use delivery containers thrown away each year", text: "Takeaway is the fastest-growing source of urban packaging waste.", source: "Industry estimates, 2025" },
      { layout: "before-after", title: "Delivery without the bin full of plastic", before: { heading: "Today", points: ["Every order ships in new plastic", "Restaurants pay twice: packaging and disposal", "Customers feel guilty"] }, after: { heading: "With Loop", points: ["Sturdy containers, returned at the next delivery", "One flat fee per use", "Zero waste per order"] } },
      { layout: "image", title: "A container that comes back", kicker: "Solution", image: { icon: "cycle" }, bullets: ["Couriers collect empties at the next drop-off", "Washed and inspected in our hubs", "Tracked by QR, 200 uses each"] },
      { layout: "stats", title: "The pilot already pays for itself", stats: [{ value: "86%", label: "return rate", icon: "cycle" }, { value: "3.1×", label: "cheaper per use", icon: "coin" }, { value: "42", label: "restaurants live", icon: "building" }] },
      { layout: "chart", title: "Orders in Loop containers doubled every quarter", chart: { type: "column", labels: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "Orders (thousands)", values: [4, 9, 17, 36] }] }, takeaway: "Growth is restaurant-led: no paid marketing yet." },
      { layout: "matrix", title: "Only Loop is both reusable and built into delivery", x: { label: "Delivery integration", low: "None", high: "Native" }, y: { label: "Reusability", low: "Single-use", high: "Reusable" }, quadrants: [{ title: "Deposit schemes", text: "Reusable, but customers return items themselves." }, { title: "Loop", text: "Collected by the courier at the next order." }, { title: "Compostables", text: "Better material, still single-use." }, { title: "Platform bags", text: "Integrated, still waste." }], highlight: 1, points: [{ label: "Us", x: 0.85, y: 0.85 }, { label: "CupClub", x: 0.2, y: 0.8 }, { label: "Vegware", x: 0.3, y: 0.2 }] },
      { layout: "team", title: "A team that has built logistics before", people: [{ name: "Sara Okafor", role: "CEO", text: "Ex-Deliveroo ops, scaled 3 cities" }, { name: "Tom Lindqvist", role: "CTO", text: "Built tracking at Oatly" }, { name: "Priya Raman", role: "COO", text: "Ran hubs for HelloFresh" }] },
      { layout: "roadmap", title: "Eighteen months to three cities", phases: [{ label: "Now", title: "London pilot", items: ["42 restaurants", "1 wash hub"] }, { label: "H1 2027", title: "London scale", items: ["400 restaurants", "Platform API"] }, { label: "H2 2027", title: "Manchester", items: ["2nd hub", "Grocery trial"] }, { label: "2028", title: "Paris", items: ["EU entity", "Series A"] }], now: 0 },
      { layout: "big-number", title: "The ask", value: "$2.5M", label: "seed round for 18 months of runway", text: "Hubs and couriers 55% · Engineering 30% · Sales 15%" },
      { layout: "closing", title: "Let's make takeaway waste-free", subtitle: "sara@loop.example" },
    ],
  },
  "report-q3": {
    title: "Q3 2026 Operations Review", subtitle: "Board meeting · 14 October 2026", author: "Operations",
    archetype: "report", brief: { audience: "the board", purpose: "report Q3 results and agree two decisions" },
    slides: [
      { layout: "title" },
      { layout: "stats", title: "Q3 beat plan on revenue and margin; churn is the concern", stats: [{ value: "$48.2M", label: "Revenue", detail: "+12% vs plan" }, { value: "31.4%", label: "Gross margin", detail: "+2.1 pts" }, { value: "4.8%", label: "Monthly churn", detail: "+0.9 pts, above target" }, { value: "212", label: "Headcount", detail: "On plan" }] },
      { layout: "section", title: "Revenue" },
      { layout: "chart", title: "Enterprise drove two thirds of the growth", chart: { type: "bar", labels: ["Enterprise", "Mid-market", "SMB", "Partners"], series: [{ name: "Q2", values: [18.1, 12.4, 9.8, 3.2] }, { name: "Q3", values: [22.6, 13.5, 8.9, 3.2] }], unit: "$M" }, source: "Finance close, 3 Oct 2026" },
      { layout: "table", title: "Every region grew except SMB in EMEA", table: { header: ["Region", "Revenue ($M)", "vs plan", "Churn"], rows: [["North America", "26.4", "+14%", "4.1%"], ["EMEA", "13.9", "+6%", "6.2%"], ["APAC", "7.9", "+18%", "3.9%"]] }, takeaway: "EMEA SMB churn explains most of the gap to target." },
      { layout: "section", title: "Risks and decisions" },
      { layout: "matrix", title: "Two risks need action this quarter", x: { label: "Likelihood", low: "Low", high: "High" }, y: { label: "Impact", low: "Low", high: "High" }, quadrants: [{ title: "Watch", items: ["Key-person risk in data team"] }, { title: "Act now", items: ["EMEA SMB churn", "Cloud cost overrun"] }, { title: "Accept", items: ["FX movements"] }, { title: "Monitor", items: ["Supplier delays"] }], highlight: 1 },
      { layout: "two-column", title: "Decisions we need from the board", left: { heading: "Approve", bullets: ["$1.2M retention programme for EMEA SMB", "Move 30% of compute to reserved instances"] }, right: { heading: "Note", bullets: ["Q4 hiring paused in G&A", "Pricing review returns in January"] } },
      { layout: "roadmap", title: "Q4 priorities", phases: [{ label: "October", items: ["Launch retention offers"] }, { label: "November", items: ["Reserved instances live", "Churn deep-dive"] }, { label: "December", items: ["Q4 close", "2027 plan to board"] }], now: 0 },
    ],
  },
  "kids-water-cycle": {
    title: "The Amazing Water Cycle", subtitle: "Science for Year 3", author: "Ms. Lee",
    archetype: "kids", brief: { audience: "children aged 7–8", purpose: "a fun first lesson on the water cycle", tone: "playful" },
    slides: [
      { layout: "title", kicker: "Science time!" },
      { layout: "statement", statement: "Where does rain come from?", text: "Have a think and tell the person next to you." },
      { layout: "icons", title: "Today we will learn", items: [{ icon: "sun", title: "The sun warms water" }, { icon: "cloud", title: "Clouds are made of drops" }, { icon: "water", title: "Rain comes back down" }] },
      { layout: "diagram", title: "Water goes round and round", diagram: { type: "cycle", center: "The water cycle", items: ["Evaporation", "Condensation", "Rain", "Collection"] } },
      { layout: "image", title: "The sun is the engine", image: { icon: "sun" }, text: "When the sun warms puddles, lakes and the sea, some water turns into invisible vapour and floats up into the sky." },
      { layout: "big-number", title: "Fun fact!", value: "9 days", label: "is how long a drop of water stays in the sky", text: "Then it falls back down as rain or snow." },
      { layout: "cards", title: "Let's try it!", items: [{ title: "Bag in the window", text: "Put a little water in a sealed bag and tape it to a sunny window.", icon: "home" }, { title: "Watch the drops", text: "After lunch, look for tiny drops near the top.", icon: "eye" }, { title: "Draw it", text: "Draw arrows to show where the water went.", icon: "pencil" }] },
      { layout: "closing", title: "Great job, scientists!", subtitle: "Next time: why is the sea salty?" },
    ],
  },
  "defence-gnn": {
    title: "Graph neural networks for city-scale traffic forecasting", subtitle: "PhD thesis defence", author: "Lin Wei · Department of Computer Science",
    archetype: "defence", brief: { audience: "examination committee", purpose: "defend the thesis", minutes: 40 },
    slides: [
      { layout: "title" },
      { layout: "statement", kicker: "The problem", statement: "Traffic forecasts fail exactly when cities need them: during incidents and events." },
      { layout: "agenda", title: "Outline", items: ["Research questions", "Related work", "Method: ST-GraphNet", "Results", "Contributions and limitations"] },
      { layout: "cards", title: "Three research questions", items: [{ title: "RQ1", text: "Can road topology improve forecasts under disruption?" }, { title: "RQ2", text: "How far ahead do spatial signals help?" }, { title: "RQ3", text: "Can the model explain which roads drove a forecast?" }] },
      { layout: "comparison", title: "Existing methods trade accuracy for structure", columns: [{ heading: "Time-series", points: ["Strong on regular days", "Ignores road network"] }, { heading: "CNN on grids", points: ["Captures space", "Distorts road topology"] }, { heading: "Graph models", points: ["Respect topology", "Struggle with incidents"] }] },
      { layout: "equation", title: "ST-GraphNet mixes neighbours with learned attention", math: "h_v^{(l+1)} = \\sigma\\Big(\\sum_{u \\in N(v)} \\alpha_{vu} W^{(l)} h_u^{(l)}\\Big)", text: "Attention weights α change with incidents, so the model reroutes information as traffic does." },
      { layout: "chart", title: "Error falls 18% on disrupted days", chart: { type: "column", labels: ["ARIMA", "LSTM", "DCRNN", "ST-GraphNet"], series: [{ name: "MAE, normal days", values: [4.9, 3.8, 3.1, 2.9] }, { name: "MAE, disrupted days", values: [9.7, 7.9, 6.4, 5.2] }] }, takeaway: "The gain is largest exactly when forecasts matter most." },
      { layout: "icons", title: "Contributions", items: [{ icon: "layers", title: "A model", text: "Incident-aware attention over road graphs" }, { icon: "database", title: "A dataset", text: "18 months of sensor data with labelled incidents" }, { icon: "eye", title: "An explanation method", text: "Which roads drove each forecast" }] },
      { layout: "two-column", title: "Limitations and future work", left: { heading: "Limitations", bullets: ["Single city", "Sensors only on major roads"] }, right: { heading: "Future work", bullets: ["Transfer to new cities", "Fuse GPS probe data"] } },
      { layout: "closing", title: "Thank you", subtitle: "Questions from the committee" },
    ],
  },
  "workshop-design-thinking": {
    title: "Design Thinking in a Day", subtitle: "Hands-on workshop", author: "Studio North",
    archetype: "workshop", brief: { audience: "product teams new to design thinking", purpose: "run a one-day workshop" },
    slides: [
      { layout: "title" },
      { layout: "agenda", title: "Today", items: ["09:30 Empathise: interviews", "11:00 Define: problem statements", "13:30 Ideate: crazy eights", "15:00 Prototype & test"] },
      { layout: "diagram", title: "Five modes, not five steps", diagram: { type: "layers", items: [{ title: "Test", text: "Put it in front of real people" }, { title: "Prototype", text: "Make it real enough to react to" }, { title: "Ideate", text: "Go wide before you go deep" }, { title: "Define", text: "Frame the right problem" }, { title: "Empathise", text: "Understand the people you serve" }] } },
      { layout: "statement", kicker: "Exercise 1 · 25 minutes", statement: "Interview your partner about the last time they cooked for friends. Ask 'why' five times.", text: "Write one surprising thing on a sticky note." },
      { layout: "process", title: "Crazy eights in eight minutes", steps: [{ title: "Fold", text: "Fold A4 into eight panels." }, { title: "Sketch", text: "One idea per minute." }, { title: "Pick", text: "Star your two favourites." }, { title: "Share", text: "Pitch them in 60 seconds." }] },
      { layout: "icons", title: "What good looks like", items: [{ icon: "person", title: "Real people", text: "Quotes, not assumptions" }, { icon: "idea", title: "Many ideas", text: "Quantity before quality" }, { icon: "tools", title: "Rough prototypes", text: "Paper beats pixels" }, { icon: "chat", title: "Honest feedback", text: "Listen, don't defend" }] },
      { layout: "closing", title: "Thanks for making things today", subtitle: "Slides and templates: studionorth.example/dt" },
    ],
  },
  "brand-northwind": {
    title: "Northwind Bakery × Your Café", subtitle: "Wholesale partnership proposal", author: "Northwind Bakery",
    archetype: "sales", brand: { name: "Northwind Bakery", primary: "#7B2D26", secondary: "#E0A458", headingFont: "Rockwell", bodyFont: "Segoe UI" },
    brief: { audience: "independent café owners", purpose: "win wholesale accounts" },
    slides: [
      { layout: "title" },
      { layout: "big-number", value: "6 a.m.", label: "fresh bread at your door, every day", text: "Baked overnight in our Leeds kitchen and delivered before you open." },
      { layout: "icons", title: "What you get", items: [{ icon: "truck", title: "Daily delivery" }, { icon: "leaf", title: "Organic flour" }, { icon: "calendar", title: "Flexible orders" }, { icon: "handshake", title: "No minimum term" }] },
      { layout: "table", title: "Simple wholesale pricing", table: { header: ["Product", "Unit", "Price"], rows: [["Sourdough loaf", "800 g", "£2.40"], ["Croissant", "each", "£0.85"], ["Cinnamon bun", "each", "£1.10"], ["Rye loaf", "750 g", "£2.60"]] } },
      { layout: "quote", quote: "Our weekend queue doubled after we switched to Northwind.", by: "Hannah, The Corner Cup" },
      { layout: "closing", title: "Start with a free tasting week", subtitle: "orders@northwind.example · 0113 000 0000" },
    ],
  },
  "keynote-mobility": {
    title: "Streets for people", subtitle: "The next decade of urban mobility", author: "Keynote · Future Cities Summit",
    archetype: "keynote", brief: { audience: "city leaders and planners", tone: "dark, cinematic", minutes: 20 },
    slides: [
      { layout: "title" },
      { layout: "big-number", value: "70%", label: "of the world will live in cities by 2050", text: "Our streets were designed for a different century." },
      { layout: "statement", statement: "The fastest way to fix traffic is to need less of it." },
      { layout: "image", side: "full", title: "Fifteen-minute neighbourhoods", text: "Everything you need, a short walk or ride from home.", image: { art: true } },
      { layout: "before-after", title: "What changes on an ordinary street", before: { heading: "2025", points: ["Four lanes of cars", "Parking on both sides", "Narrow pavements"] }, after: { heading: "2035", points: ["Two lanes, one for buses", "Trees and protected bike lanes", "Cafés where parking was"] } },
      { layout: "diagram", title: "Mobility is a stack, not a choice", diagram: { type: "pyramid", items: ["Walking", "Cycling", "Public transport", "Shared vehicles", "Private cars"] } },
      { layout: "closing", title: "Start with one street", subtitle: "Thank you" },
    ],
  },
  "circuit-lecture-preset": {
    title: "Voltage dividers in practice", subtitle: "From Ohm's law to sensor circuits", author: "Clem", theme: { preset: "lab" },
    slides: [
      { layout: "title", kicker: "Electronics 101" },
      { layout: "figure", title: "A 12 V divider", figure: circuit, caption: "R1 = 100 Ω, R2 = 200 Ω", bullets: ["I = 40 mA", "V2 = 8 V"] },
      { layout: "image", title: "The same divider, drawn as a schematic", image: { figure: circuit }, side: "left", bullets: ["Two resistors in series", "Output taken across R2"] },
      { layout: "equation", title: "Arrows carry their labels", math: "N_2 + 3H_2 \\xrightarrow[\\text{450 °C, Fe}]{\\text{200 atm}} 2NH_3 \\qquad V_{in} \\xRightarrow{\\text{divider}} V_{out}", text: "Vector notation: $\\overrightarrow{AB}$ and $A \\xleftarrow{f} B$." },
      { layout: "bullets", title: "Maths in the middle of a sentence", bullets: ["The divider gives $V_{out} = \\frac{R_2}{R_1 + R_2} V_{in}$ across the second resistor", "Power is $P = I^2 R$, and the spread is $\\sqrt{a^2 + b^2}$", "Summing $\\sum_{i=1}^{n} x_i$ for every reading; $\\int_0^1 f(x)\\,dx$ for the average"], takeaway: "Equations stay editable: $E = mc^2$ sits in line with the words." },
      { layout: "equation", title: "Long labels stretch the arrow", math: "\\overrightarrow{PQ} = \\vec{q} - \\vec{p} \\qquad A \\xrightarrow{\\text{after a very long reaction}} B" },
      { layout: "closing", title: "Questions?" },
    ],
  },
};
