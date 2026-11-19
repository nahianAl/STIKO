## **Question changes at a glance**

Use the After column as the exact text on the onboarding page. Every question is fixed and the same for all customers. Business type is now called Market (see Field 2).

| Field | Before | After |
| ----- | ----- | ----- |
| Pillar | What best describes your work? | **What industry are you in?** |
| Market (was Business type) | Which best describes your business? | **What do you work on?** |
| Client model | Who do you design or build for? | **Who do you mainly work for?** |
| Review team size | How many people on your team share or review designs? | **How many people on your team review designs?** |
| Role | What is your role? | **What's your role?** |
| External reviewers | Who do you share designs with for feedback? | **Who reviews your designs?** |
| File types | What files do you usually share for review? | **What files do you share for review?** |

Company size ("How many people work at your company?") is already standard and stays as is.

## **Summary**

Replace the 5-step flow with one page of 9 dropdowns: Company website plus the 8 fields from the field spec. No other questions are added.

| \# | Field | Question shown | Helper text | Type |
| ----- | ----- | ----- | ----- | ----- |
| 0 | Company website (new) | What's your company website? | Placeholder: yourcompany.com | Text input (URL) |
| 1 | Pillar | What industry are you in? | Pick the closest match. | Dropdown, single select |
| 2 | Market | What do you work on? | Select up to 3, starting with your biggest market. | Dropdown, multi select (up to 3), grouped (same list for everyone) |
| 3 | Client model | Who do you mainly work for? |  | Dropdown, single select |
| 4 | Company size | How many people work at your company? |  | Dropdown, single select |
| 5 | Review team size | How many people on your team review designs? | Include anyone who uploads, comments or approves. | Dropdown, single select |
| 6 | Role | What's your role? | Pick the closest match. | Dropdown, single select, filtered by industry |
| 7 | External reviewers | Who reviews your designs? | Select all that apply. | Dropdown, multi select, filtered by industry |
| 8 | File types | What files do you share for review? | Select all that apply. | Dropdown, multi select, grouped by format |

The granularity comes from inside the dropdowns, not from extra questions:

* **Business type** is now Market: one fixed list of 31 options for everyone. Industry says what kind of firm; Market says what the work is for. Up to 3 picks; the first is the primary market used for the main pivot.  
* **Role, External reviewers and File types** show only the options that fit the chosen pillar, so each list is specific without getting longer.  
* **File types** lists individual formats instead of 6 broad buckets, so you can see exactly which formats are in demand.

## **How the questions are worded**

Every question uses plain, everyday words, asks one thing, and fits in 8 words or fewer. Every question and answer list is fixed: all customers see the same wording, which keeps the data easy to compare.

**Wording rules**

* Ask the way a person would ask out loud: "What's your role?" not "Which best describes your role?"  
* One idea per question. No "share or review" or "design or build" pairs.  
* Use the reader's own words: "industry", "products", "process", not internal terms like pillar, segment or client model.  
* Helper text only where it removes doubt: "Pick the closest match." on long lists, "Select all that apply." on multi selects.  
* Internal field names (Pillar, Market) never appear on the page.

## **What the video shows, and what to fix**

The live flow asks 5 of the 8 spec fields across 5 screens. Review team size, External reviewers and File types are missing, and there is no company website field.

| Spec field | Live today? | What the video shows | Fix |
| ----- | ----- | ----- | ----- |
| Pillar | Yes, step 1 | Not in the recording; the chosen pillar shows as a subtitle on step 2 | Split into 11 specific pillars and make it the first dropdown |
| Business type | Yes, step 2 | 9 options (A to I) for Industrial Design; no "Other" visible | Replace with one fixed Market list (see Field 2), plus Other |
| Client model | Yes, step 3 | Clients / Own products / Both | New question and 5 options (see Field 3\) |
| Company size | Yes, step 4 | Just me, 2-4, 5-9, 10-24, 25-49, 50-99, 100-249, 250+ | Keep the live bands; update the spec, which still says 1-4 |
| Review team size | **No** |  | Add |
| Role | Yes, step 5 | Same 11 roles for every pillar (Architect shown to an industrial design firm) | Filter the list by pillar |
| External reviewers | **No** |  | Add, filtered by pillar |
| File types | **No** |  | Add, listed by individual format |
| Company website | **No** |  | Add as the first field |

**Keep from the current build:** helper text under each industry option (it helps people pick the right option), the disabled button until required fields are filled, and the marketing opt-in unchecked by default.

## **The single page**

All 9 fields sit on one page in the order below, with one "Create workspace" button at the bottom. Pillar is the only parent field: once it is picked, Role and External reviewers load the list for that pillar.

| Order | Field | Required | Behaviour |
| ----- | ----- | ----- | ----- |
| 0 | Company website | Yes | Prefill from the signup email domain when it is a work email. Accept "acme.com" or a full URL and store the bare domain. Add a "We don't have a website yet" checkbox so nobody gets stuck. |
| 1 | Pillar | Yes | 11 options plus Other. Picking Other opens a required text box ("What industry are you in?"). Changing the pick clears Role and External reviewers. |
| 2 | Market | Yes | Same fixed list for every industry. Multi select, up to 3\. Keep picks in the order chosen and label the first tag "Primary"; people can drag tags to change which one is primary. Searchable, with group headers. Last option is "Other (please specify)" with a short text box. |
| 3 | Client model | Yes | 5 options for Product Development, Manufacturing and Construction & Fabrication; 4 for all other industries |
| 4 | Company size | Yes | 8 bands |
| 5 | Review team size | Yes | 6 bands. Hide any band larger than the chosen Company size. |
| 6 | Role | Yes | List for the chosen pillar, ends with Other |
| 7 | External reviewers | Optional | Multi select. List for the chosen pillar. |
| 8 | File types | Optional | Multi select, grouped by format family |

**Dropdown rules**

* Searchable for Market, Role and File types. Typing "CNC", "molding" or "millwork" should jump straight to the right option, so index common synonyms.  
* **Multi selects show picks as removable tags** inside the field, so the page doesn't grow.  
* **Keep keyboard support** from the current build: Tab between fields, arrow keys and Enter inside a dropdown.  
* **Store a code for every option** (e.g. MK-14), never the label. Labels can be reworded later without breaking past data. Reconcile the codes with the existing "Business Types" tab before launch.

## **Field 1: Pillar, split into 11**

Split the 4 broad pillars into 11 that each describe one kind of firm. Each new pillar also stores its parent segment, so reports and the 4 solution pages still roll up.

Question: **What industry are you in?** (single select, required)

| Order | Code | Option shown | Helper text | Parent segment | Priority |
| ----- | ----- | ----- | ----- | ----- | ----- |
| 1 | IND | Industrial Design | Designing the form, function and finish of physical products | Industrial Design & Concept Development | Core |
| 2 | CON | Concept Development | Early-stage ideas, research, concepts and appearance models | Industrial Design & Concept Development | Core |
| 3 | PRD | Product Development | Engineering products from concept to production-ready design | Product Development & Manufacturing | Beachhead |
| 4 | MFG | Manufacturing | Making parts, tooling or finished products | Product Development & Manufacturing | Beachhead |
| 5 | ARC | Architecture & Building Engineering | Designing buildings, sites and building systems | Architecture, Interior & Construction | Core |
| 6 | INT | Interior Design | Designing interiors, fit-outs and furnishings | Architecture, Interior & Construction | Core |
| 7 | CST | Construction & Fabrication | Building, renovating, fabricating or developing projects | Architecture, Interior & Construction | Core |
| 8 | VIZ | 3D Visualization & CGI | Renders, 3D animation and 3D assets | Graphic Design, Video & Photography | Secondary (3D-heavy, watch closely) |
| 9 | GRD | Graphic Design & Branding | Brand, packaging, print and digital design | Graphic Design, Video & Photography | Secondary |
| 10 | VID | Video & Animation | Production, post-production and motion | Graphic Design, Video & Photography | Secondary |
| 11 | PHO | Photography | Product, architecture and commercial photography | Graphic Design, Video & Photography | Secondary |
| 12 | OTH | Other | Please specify |  |  |

The order follows the work, from idea to build, so people find their pillar quickly. Priority is for your reporting only and is not shown in the dropdown.

**Where engineers go:** mechanical and electrical engineering firms pick Product Development. Structural, MEP and civil engineers pick Architecture & Building Engineering.

**If someone picks Other:** you still collect every field. Only the parts that depend on industry change.

| Field | What happens with Other |
| ----- | ----- |
| Pillar | Required text box appears: "What industry are you in?" Store code OTH plus their text. |
| Market | No change. Same fixed Market list as everyone else. |
| Client model, Company size, Review team size, File types | No change. Same dropdowns as everyone else. |
| Role | Shows one combined list of every role from all pillars, with duplicates removed, ending in Other. |
| External reviewers | Shows one combined list of every reviewer type, with duplicates removed. |

Review Other answers every two weeks. If the same industry comes up 5 or more times, add it as a new industry or market.

## **Field 2: Market (replaces Business type)**

One fixed question and one fixed list, the same for every customer whatever industry they pick. Industry (Field 1\) says what kind of firm they are; Market says what their work is for.

Question: **What do you work on?** (Multi-select, up to 3, required)

Helper text: *Select up to 3, starting with your biggest market.*

| Group header | Code | Option shown |
| ----- | ----- | ----- |
| Consumer products | MK-01 | Consumer electronics |
| Consumer products | MK-02 | Home appliances |
| Consumer products | MK-03 | Furniture and lighting |
| Consumer products | MK-04 | Home goods and decor |
| Consumer products | MK-05 | Sports, outdoor and fitness |
| Consumer products | MK-06 | Toys and juvenile |
| Consumer products | MK-07 | Fashion, footwear and accessories |
| Consumer products | MK-08 | Beauty and personal care |
| Consumer products | MK-09 | Food and beverage |
| Consumer products | MK-10 | Packaging |
| Industrial and technical | MK-11 | Medical and health devices |
| Industrial and technical | MK-12 | Automotive and EV |
| Industrial and technical | MK-13 | Aerospace and defense |
| Industrial and technical | MK-14 | Marine, RV and specialty vehicles |
| Industrial and technical | MK-15 | Industrial equipment and machinery |
| Industrial and technical | MK-16 | Robotics and automation |
| Industrial and technical | MK-17 | Tools and hardware |
| Industrial and technical | MK-18 | Electronics and PCBs |
| Industrial and technical | MK-19 | Energy and cleantech |
| Industrial and technical | MK-20 | Building products and HVAC |
| Buildings and spaces | MK-21 | Residential |
| Buildings and spaces | MK-22 | Commercial and office |
| Buildings and spaces | MK-23 | Retail and hospitality |
| Buildings and spaces | MK-24 | Healthcare and education |
| Buildings and spaces | MK-25 | Industrial and warehouse |
| Buildings and spaces | MK-26 | Infrastructure and civil |
| Buildings and spaces | MK-27 | Landscape and public spaces |
| Buildings and spaces | MK-28 | Exhibitions and events |
| Media and brand | MK-29 | Brand and marketing content |
| Media and brand | MK-30 | Entertainment, film and games |
|  | MK-99 | Other (please specify) |

**For analysis:** store the first pick as primary\_market (one per account) and every pick in a separate account\_markets table (account\_id, market\_code, pick\_order). Use primary\_market for the main Industry × Market pivot so each customer is counted once; use the full list to see how many firms work in a market at all. One pivot of Industry × Market, cut by trials and trial-to-paid, answers most questions. For example, "Manufacturing × Medical and health devices". No per-industry code lists to map or merge.

**Trade-off:** the fixed list does not capture how a firm works, such as CNC versus molding or general contractor versus trade. File types partly fills the gap. If process detail matters later, ask it inside the app after signup, not in onboarding.

## **The other six fields, broken down**

### **Field 3: Client model**

**Problems with the current version**

* "Who do you design or build for?" doesn't fit manufacturers, contractors or developers, who don't think of themselves as designing *for* anyone.  
* "Both" hides the main business model, so a studio with one side product looks the same as a brand that sometimes takes client work.  
* There is no option for suppliers who make parts to someone else's design. Suppliers are the core of the reviewer-invite loop in the beachhead, so you need to spot them.

**New question:** Who do you mainly work for? (single select, required)

Helper text: *Pick the one that describes most of your work.*

| Code | Option shown | Helper text | Shown for |
| ----- | ----- | ----- | ----- |
| CM-1 | Clients | We're a studio, agency, firm, consultant or contractor | All pillars |
| CM-2 | Our own company | We're the brand, manufacturer, owner or developer | All pillars |
| CM-3 | Other companies, as a supplier | We make parts, tooling or products to their designs | Product Development, Manufacturing, Construction & Fabrication |
| CM-4 | Mostly clients, some our own |  | All pillars |
| CM-5 | Mostly our own, some clients |  | All pillars |

What each answer tells you:

* **CM-1:** they invite clients to review, so expect many outside reviewers and several projects running at once.  
* **CM-2:** reviews happen inside one company with suppliers or partners. Strongest sign of a team-wide rollout.  
* **CM-3:** they get invited by their customers and send models back for approval. Good targets for the free reviewer-to-paid path.  
* **CM-4 and CM-5:** replace "Both" and keep the main business model visible.

### **Field 4: Company size**

Keep the live bands: Just me · 2-4 · 5-9 · 10-24 · 25-49 · 50-99 · 100-249 · 250+. They already split cleanly around the 5 to 50+ target range. Update the spec sheet, which still lists 1-4.

### **Field 5: Review team size**

1 (just me) · 2-4 · 5-9 · 10-24 · 25-49 · 50+

The spec stops at 25+. Splitting it into 25-49 and 50+ separates mid-size teams from large ones, which matters for seat pricing.

### **Field 6: Role**

**Question:** What's your role? (single select, required)

Helper text: *Pick the closest match.*

Short and standard. The helper text steers people to the closest option, so fewer pick Other.

**Are the current options enough? Not quite.** Three gaps:

1. **No seniority split.** "Designer" or "Engineer" can't tell the buyer from the day-to-day user. Each list below starts with 2 or 3 leadership options (owner, director, manager) so you can see who signs.  
2. **Missing common jobs.** For example: estimator, superintendent and BIM manager in construction; quality engineer and toolmaker in manufacturing; design researcher and model maker in concept work.  
3. **No way to spot non-buyers.** Add "Student or educator" so they don't distort trial-to-paid numbers.

Lists are ordered most senior first. Each ends with Other.

| Industrial Design | Concept Development | Product Development | Manufacturing |
| ----- | ----- | ----- | ----- |
| Owner / Principal / Founder | Owner / Founder | Owner / President / CEO | Owner / President / GM |
| Design director / Head of design | Innovation or R\&D director | VP or Director of engineering | Plant or operations manager |
| Design manager / Lead designer | Concept design lead | Engineering manager | Engineering manager |
| Industrial designer | Concept designer | Mechanical / design engineer | Manufacturing / process engineer |
| CMF designer | Design researcher | Electrical engineer | Tooling / mold engineer |
| Design engineer | Strategist | Industrial designer | Quality engineer / inspector |
| Mechanical engineer | Concept artist / illustrator | Product manager | CNC programmer / machinist |
| Product manager | Model maker / prototyper | Program / project manager | Estimator / sales engineer |
| Marketing / brand | Product manager | Quality / regulatory | Project / program manager |
| Student or educator | Inventor / entrepreneur | Procurement / sourcing | Procurement / supply chain |
| Other | Student or educator | Student or educator | Student or educator |
|  | Other | Other | Other |

| Architecture & Building Engineering | Interior Design | Construction & Fabrication | Secondary pillars (VIZ, GRD, VID, PHO) |
| ----- | ----- | ----- | ----- |
| Principal / Partner | Principal / Owner | Owner / President | Owner / Founder |
| Associate / Studio director | Design director | Operations director / Project executive | Creative director |
| Project architect | Senior interior designer | Project manager | Art director |
| Architect | Interior designer | Superintendent / site manager | Producer / project manager |
| Designer / intern architect | Junior designer / design assistant | Project engineer / coordinator | Designer |
| Engineer (structural, MEP, civil) | FF\&E specialist | Estimator / preconstruction | 3D artist / visualizer |
| BIM / CAD manager | Kitchen and bath designer | VDC / BIM manager | Animator / motion designer |
| Drafter / technologist | Project manager | Shop drawing detailer | Editor / colorist |
| Project manager | Procurement | Developer / owner's rep | Photographer |
| Student or educator | Student or educator | Student or educator | Account / client manager |
| Other | Other | Other | Marketing |
|  |  |  | Student or educator |
|  |  |  | Other |

### **Field 7: External reviewers, by pillar (multi select)**

| Industrial Design, Concept Development | Product Development, Manufacturing | Architecture, Interior Design, Construction | 3D Viz, Graphic, Video, Photography |
| ----- | ----- | ----- | ----- |
| Internal team | Internal team | Internal team | Internal team |
| Clients | Customers | Clients / building owners | Clients |
| Engineers | Suppliers / vendors | Structural or MEP consultants | Agencies |
| Manufacturers / factories | Contract manufacturers / factories | General contractors | Talent / freelancers |
| Prototype shops | Toolmakers / mold shops | Subcontractors / trades | Printers / vendors |
| Investors / leadership | Quality / inspection partners | Fabricators / millwork | Investors / leadership |
|  | Investors / leadership | Permitting authorities |  |
|  |  | Investors / leadership |  |

### **Field 8: File types (multi select, grouped)**

Question: **What files do you share for review?**

The list shows every format Stiko supports today, plus a few common ones it doesn't yet. When people pick those, you see real demand before deciding what to add next. Order the groups by pillar: 3D CAD first for Industrial Design, Concept, Product Development and Manufacturing; 2D drawings first for Architecture, Interior and Construction; images and video first for the secondary pillars.

**How the dropdown looks:** one multi-select dropdown. "Group header" is a grey, non-clickable label that sorts the formats into sections inside the open list. People can only tick the formats under each header. For example:

```
3D CAD                      (label, not selectable)
  [ ] STEP (.step, .stp)
  [ ] IGES (.iges, .igs)
  [ ] SolidWorks part (.sldprt)
3D models and mesh          (label, not selectable)
  [ ] GLB / glTF (.glb, .gltf)
  [ ] STL (.stl)
```

Picked formats show as removable tags in the closed field, e.g. \[STEP x\] \[PDF x\]. Store each format's code. Don't store the header.

| Group header | Format shown | Supported today |
| ----- | ----- | ----- |
| 3D CAD | **STEP (.step, .stp)** | Yes |
| 3D CAD | **IGES (.iges, .igs)** | Yes |
| 3D CAD | **SolidWorks part (.sldprt)** | Yes |
| 3D CAD | **BREP (.brep)** | Yes |
| 3D CAD | **Rhino (.3dm)** | Yes |
| 3D CAD | **SolidWorks assembly (.sldasm)** | Not yet |
| 3D CAD | **Parasolid (.x\_t)** | Not yet |
| 3D CAD | **Fusion 360, Inventor, CATIA, Creo or NX files** | Not yet |
| 3D models and mesh | **GLB / glTF (.glb, .gltf)** | Yes |
| 3D models and mesh | **FBX (.fbx)** | Yes |
| 3D models and mesh | **OBJ (.obj)** | Yes |
| 3D models and mesh | **STL (.stl)** | Yes |
| 3D models and mesh | **3MF (.3mf)** | Yes |
| 3D models and mesh | **PLY (.ply)** | Yes |
| 3D models and mesh | **3DS (.3ds)** | Yes |
| 3D models and mesh | **Collada (.dae)** | Yes |
| 3D models and mesh | **USDZ / USD (.usdz, .usda)** | Confirm |
| 2D drawings and documents | **DWG (.dwg)** | Yes |
| 2D drawings and documents | **DXF (.dxf)** | Yes |
| 2D drawings and documents | **PDF (.pdf)** | Yes |
| 2D drawings and documents | **SVG (.svg)** | Yes |
| BIM | **IFC, Revit (.rvt) or SketchUp (.skp)** | Not yet |
| Images and renders | **JPG (.jpg)** | Yes |
| Images and renders | **PNG (.png)** | Yes |
| Images and renders | **WEBP (.webp)** | Confirm |
| Images and renders | **PSD or TIFF** | Not yet |
| Video | **MP4 (.mp4)** | Yes |
| Video | **MOV (.mov)** | Not yet |
|  | **Other (please specify)** |  |

USDZ, USDA and WEBP were in the earlier supported list but not in the latest one. Confirm before launch whether they are still supported.

## **Data review: what to lock before build**

The questions are enough to describe each customer. What would block segment analysis is how the answers are stored, so lock the data spec below before the engineer builds. None of it adds a question.

### **1\. Store company answers on the account, not the user**

Revenue is billed per account and usage is counted per account, so company answers must live on the account (workspace).

| Field | Stored on | Who answers |
| ----- | ----- | ----- |
| Company website, Industry, Market, Client model, Company size, Review team size, External reviewers, File types | Account | The person who creates the workspace |
| Role | User | Everyone |

Who sees the page:

* **Creates a new workspace:** the full page.  
* **Joins an existing workspace as a teammate:** Role only. Company answers come from the account.  
* **Invited as an external reviewer:** Role only, plus their own email domain saved. Tag them as reviewers so supplier and client logins don't inflate the inviting segment's active-user counts.  
* **Second workspace from the same domain:** link both to one company record by domain.

### **2\. Keys that connect onboarding to revenue and usage**

* `account_id` on every answer, event and billing record; `user_id` for Role.  
* `billing_customer_id` (e.g. the Stripe customer) saved on the account at first payment.  
* `company_domain`: lowercase, no protocol, www or path. Also `is_free_email` (gmail, outlook, icloud and similar) and `website_source` (prefilled, typed, none).  
* In product analytics, send every company answer as an account (group) property keyed by `account_id`, not as a user property. Usage and activity then cut by segment with no extra work.

### **3\. A code for every option**

Industry, Market and Client model have codes. The other fields need them too, or each engineer will invent their own.

| Field | Code rule | Extra stored values |
| ----- | ----- | ----- |
| Company size | CS-01 to CS-08, in band order | `size_min`, `size_max` (e.g. 10 and 24\) for numeric analysis |
| Review team size | RT-01 to RT-06 | `rt_min`, `rt_max` |
| Role | One code per unique label across all lists ("Project manager" is one code everywhere) | `role_family`, `seniority` |
| External reviewers | One code per reviewer type (table below) |  |
| File types | FT- plus the format, e.g. FT-STEP, FT-PDF | `supported_at_signup` (yes or no) |
| Any "Other" | Code ends in 99 | `<field>_other_text` with what they typed |

**Role seniority values:** Owner or executive · Director · Manager or lead · Individual contributor · Student or educator. Seniority gives buyer-versus-user analysis without another question.

**Role family values:** Leadership · Design · Engineering · Project management · Operations and production · Quality · Procurement · Sales and estimating · Marketing · Creative production · Education · Other.

**External reviewer codes** (labels differ by industry, codes do not):

| Code | Labels that map to it |
| ----- | ----- |
| ER-INTERNAL | Internal team |
| ER-CLIENT | Clients · Customers · Clients / building owners |
| ER-SUPPLIER | Suppliers / vendors · Printers / vendors |
| ER-MANUFACTURER | Manufacturers / factories · Contract manufacturers / factories · Prototype shops |
| ER-TOOLING | Toolmakers / mold shops |
| ER-ENGINEER | Engineers · Structural or MEP consultants |
| ER-CONTRACTOR | General contractors · Subcontractors / trades |
| ER-FABRICATOR | Fabricators / millwork |
| ER-QUALITY | Quality / inspection partners |
| ER-AUTHORITY | Permitting authorities |
| ER-AGENCY | Agencies |
| ER-FREELANCE | Talent / freelancers |
| ER-LEADERSHIP | Investors / leadership |

### **4\. Versioning, so lists can change without breaking history**

* Save `onboarding_version` (this page is v2) and `answered_at` with every submission. Label answers from the old 5-step flow as v1.  
* Never overwrite answers. When a company profile is edited, add a new row and keep the old one with its date.  
* Retire codes, never reuse them. If an option is split, give the new options new codes and record which old code they came from.  
* Let workspace admins edit the company profile in Settings with the same dropdowns. Companies grow, and stale size bands skew expansion analysis.

### **5\. Capture these automatically at signup**

* `signup_type`: new workspace, joined teammate, invited reviewer  
* `invited_by_account_id` and `invited_by_user_id`, to measure the invite loop by segment  
* `utm_source`, `utm_medium`, `utm_campaign`, referrer and landing page, to see which channels bring which segments  
* Country and region from IP at signup; billing country later from billing  
* Signup timestamp

### **6\. Two small changes to the questions**

* **Make Role and Review team size required.** Both are one click. If they stay optional, the people who skip them won't be random, which biases buyer and seat-expansion analysis.  
* **Remove "Many markets".** It turns into a catch-all bucket nobody can analyse. With up to 3 picks, generalists can choose their real markets instead.

### **7\. Derived flags to store at signup**

* `parent_segment` from Industry (already defined in Field 1); primary\_market from the first Market pick  
* `icp_size_fit`: Company size is 5 or more  
* `decision_maker`: seniority is Owner or executive, or Director  
* `non_buyer`: Role is Student or educator

### **What this lets you answer**

Join billing and product analytics to the account record and you can rank segments (Industry × Market × Company size) by revenue, paid seats, weekly active users and invite rate, and see which roles start trials versus which ones pay. Revenue, budget and usage are measured from billing and the product, so onboarding should not ask about them.

