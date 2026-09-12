# Build a Complete Persian AI Agent Marketplace and Chat Platform

## 1. Project Overview
Build a full-stack web application for Iranian users to purchase and chat with specialized AI agents. The platform must be entirely in Persian, with RTL layout, Toman pricing, and localized content. Users sign up, get free tokens, browse a marketplace of agents, purchase them, and chat via a simple interface. Each chat message consumes tokens based on Claude API usage.

**Target User:** Non-technical individuals who want to accomplish tasks without coding.

**Key Features:**
- User authentication (email/password + Google OAuth)
- Agent marketplace with search, filtering, and sorting
- Agent detail page with purchase option
- Chat interface with real-time streaming, token tracking, and conversation history
- User dashboard for managing agents, conversations, billing, and referrals
- Admin panel for managing agents, users, and transactions
- Token management system with balance, monthly limits, and top-up packages
- Referral system and promo codes
- Payment integration (Zarinpal placeholder; Stripe optional)

## 2. Technical Stack
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions, Realtime)
- **AI:** Anthropic Claude API (models: claude-3-5-haiku, claude-3-5-sonnet)
- **Payments:** Zarinpal (primary) with a mock implementation for MVP; Stripe as secondary optional
- **Deployment:** Vercel (auto via Lovable)
- **Charts:** Recharts for token usage graphs

## 3. Design System and UI Guidelines
- **Direction:** All pages `dir="rtl"`, `lang="fa"`. Use Persian digits in all numbers (e.g., ۵۰,۰۰۰).
- **Theme:** Dark mode only, minimalist.
- **Colors:**
  - Primary: `#7C3AED` (بنفش)
  - Secondary: `#3B82F6` (آبی)
  - Background: `#0F172A`
  - Card: `#1E293B`
  - Text primary: `#F8FAFC`
  - Text secondary: `#94A3B8`
  - Success: `#10B981`
  - Danger: `#EF4444`
  - Gradient primary: `linear-gradient(135deg, #7C3AED, #3B82F6)`
- **Border Radius:** Cards 16px, Buttons 10px, Inputs 8px.
- **Fonts:** Vazirmatn for Persian, Inter for any English, JetBrains Mono for code blocks.
- **Spacing:** Use consistent spacing: section padding 24px, gap between cards 20px.
- **Effects:** Smooth transitions (0.3s), hover lift on cards, subtle shadows.
- **Responsive:** Mobile-first; breakpoints: sm 640px, md 768px, lg 1024px, xl 1280px.
- **RTL specifics:** Buttons, inputs, and text alignment must follow RTL; icons that indicate direction should be mirrored (e.g., arrow icons).
- **Empty states:** Show relevant messages like "هیچ ایجینتی یافت نشد" or "هنوز مکالمهای ندارید".
- **Loading states:** Use skeleton loaders for lists, and spinners for buttons.

## 4. Page Specifications

### 4.1 Landing Page (`/`)
**Header:**
- Logo (text "ایجنتفا" or similar)
- Nav links: فروشگاه (Marketplace), قیمتها (Pricing), ورود (Login)
- CTA button: "شروع رایگان" (Start Free) — links to signup
- If user logged in, show avatar and link to dashboard.

**Hero Section:**
- Title: "دستیارهای هوش مصنوعی که واقعاً کارهات رو انجام میدن"
- Subtitle: "بدون نیاز به دانش فنی، با ایجنتهای تخصصی چت کن و کارهات رو انجام بده"
- Buttons: primary "شروع رایگان – ۵۰,۰۰۰ توکن هدیه" (link to signup), secondary "مشاهده دمو" (link to video placeholder).
- Background: subtle gradient or illustration.

**Featured Agents:**
- Show 6 most popular agents (from seed data) in grid.
- Each card: icon, name, rating, price, short description, "مشاهده" button.
- Link to full marketplace.

**How It Works:**
- Three steps with icons:
  1. ثبتنام کنید (Sign up)
  2. ایجنت انتخاب کنید (Choose an agent)
  3. چت کنید و نتیجه بگیرید (Chat and get results)

**Testimonials:**
- 3 sample Persian testimonials with avatar, name, and quote.

**FAQ:**
- Accordion with 6 questions:
  1. ایجنت چیست؟
  2. چقدر هزینه دارد؟
  3. آیا نیاز به دانش فنی دارم؟
  4. چطور توکن بخرم؟
  5. آیا میتوانم اشتراک را لغو کنم؟
  6. ضمانت بازگشت وجه چگونه است؟

**Footer:**
- Links: قوانین و مقررات, حریم خصوصی, تماس با ما
- Copyright text.

### 4.2 Authentication Pages
**Sign Up (`/signup`)**
- Form: نام کامل (Full name), ایمیل, رمز عبور, تکرار رمز عبور.
- Button: "ثبتنام"
- Alternative: "ورود با گوگل" (Google OAuth)
- On success: redirect to dashboard, show welcome modal: "۵۰,۰۰۰ توکن هدیه به حساب شما اضافه شد!"

**Login (`/login`)**
- Form: ایمیل, رمز عبور.
- Button: "ورود"
- Link to "فراموشی رمز عبور؟"
- Alternative: Google OAuth.

**Email Verification (`/verify`)**
- Message: "ایمیلی برای تأیید حساب شما ارسال شد. لطفاً لینک موجود در ایمیل را کلیک کنید."
- Button to resend.

**Password Reset (`/reset-password`)**
- Request form (email) and reset form (new password).

### 4.3 Agent Marketplace (`/marketplace`)
- **Search bar:** at top, real-time filtering.
- **Category tabs:** همه، توسعه، داده، مارکتینگ، کسبوکار، طراحی.
- **Sort dropdown:** محبوبترین، جدیدترین، ارزانترین، گرانترین.
- **Grid of agent cards** (3 columns desktop, 1 mobile):
  - Icon (emoji, large)
  - Name (e.g., "معمار بکاند")
  - One-line description (e.g., "طراحی API و معماری سیستم")
  - Rating stars (e.g., ⭐ ۴.۸)
  - Sales count ("۱,۲۳۴ فروش")
  - Price (e.g., "۴۹,۰۰۰ تومان")
  - If user not logged in: buttons "مشاهده" (view details) and "خرید" (buy) — buy redirects to login if not authenticated.
  - If logged in and not purchased: "خرید" button.
  - If purchased: "چت" button (link to chat) and "مشاهده".
  - Badge "پرفروش" if is_featured, "جدید" if created within last 30 days.
- **Empty state:** if no agents match filters: "هیچ ایجینتی مطابق جستجو یافت نشد."

### 4.4 Agent Detail Page (`/agent/[slug]`)
- **Top section:**
  - Large icon, name, rating, sales count, price.
  - Buttons:
    - If not purchased: "خرید ایجنت" (primary), "پیشنمایش رایگان" (secondary, starts limited chat with 3 messages).
    - If purchased: "شروع چت" (primary).
  - "ضمانت ۷ روزه بازگشت وجه" badge.
- **Description:** 2-3 paragraphs (from `long_description`).
- **Features:** bullet list (from `features` array).
- **Sample Prompts:** chips (from `suggested_prompts`), clicking starts a new chat with that prompt.
- **User Reviews:** 2-3 sample reviews (static) with Persian names, ratings, comments.
- **Related Agents:** up to 4 from same category, shown as small cards.

### 4.5 Chat Interface (`/chat/[agentId]` or `/chat?agent=...`)
- **Three-column layout on desktop:**
  - **Right sidebar (width 280px):** Conversation list for this agent. If no conversations, show "گفتگویی ندارید". Top: "گفتگوی جدید" button. Each item: agent icon, title (or "گفتگوی جدید"), last message preview, timestamp, token count. Clicking loads that conversation.
  - **Center:**
    - Header: agent icon, name, "آنلاین" indicator, buttons: "دانلود گفتگو" (download transcript), "پاککردن گفتگو" (clear).
    - Messages area:
      - User messages: right-aligned, background `#7C3AED`, white text, rounded.
      - Agent messages: left-aligned, background `#1E293B`, border, rounded.
      - Under each agent message: small text "مصرف: ۱۸۰ توکن".
      - Typing indicator: three animated dots when agent is generating.
      - If conversation is new, show welcome message (from agent) and suggested prompt chips.
    - Input area: textarea (auto-resize), attach icon (disabled), send button (arrow). Enter sends, Shift+Enter newline.
  - **Left sidebar (width 250px, collapsible):**
    - Agent info: icon, name, category.
    - "مصرف این گفتگو": total tokens used.
    - "موجودی توکن شما": live token balance.
    - Button "خرید توکن بیشتر" → modal with token packages.
    - Button "ارتقا پلن" → link to pricing.
    - Button "پاککردن گفتگو" → confirmation.
- **Mobile:** Sidebars collapsed into hamburger menu; chat takes full width.
- **Streaming:** Use fetch with `ReadableStream` to display tokens as they arrive. Update token balance after response completes.
- **If token balance insufficient:** show modal: "اعتبار توکن شما کافی نیست" with buttons "خرید توکن" and "ارتقا پلن".

### 4.6 User Dashboard (`/dashboard`)
- **Layout:** Sidebar (right) with links: نمای کلی، گفتگوها، ایجنتهای من، صورتحساب، تنظیمات، دعوت دوستان. Main content area.
- **Overview Tab:**
  - Welcome: "سلام، [name]!"
  - Three stat cards: موجودی توکن (current balance), ایجنتهای من (count), مکالمات این ماه (count).
  - Token usage chart (last 30 days) using Recharts line chart, RTL labels.
  - "ایجنتهای من" grid: only purchased agents, each with "چت" button.
  - Recent conversations (last 5) with continue link.
  - Buttons: "خرید توکن" and "ارتقا پلن".
- **Conversations Tab:**
  - List all conversations across all agents.
  - Filter by agent (dropdown), search by title.
  - Each row: agent icon, title, last message, date, token count, actions (ادامه، حذف).
  - Pagination or infinite scroll.
- **My Agents Tab:**
  - Grid of purchased agents with icon, name, description, "چت" button, "مشاهده" link.
- **Billing Tab:**
  - Current plan and token balance.
  - Transaction history table: date, description, amount (Toman), tokens added, status.
  - Buttons to buy token packages or change plan.
- **Settings Tab:**
  - Profile: name, avatar upload (file upload to Supabase Storage), email (read-only).
  - Password change.
  - Notification preferences (checkboxes for email alerts).
  - Delete account (with confirmation).
- **Referral Tab:**
  - Unique referral link (`https://yourdomain.com/signup?ref=[userId]`).
  - Stats: number of referrals, tokens earned.
  - Explanation: "با دعوت هر دوست، هر دوی شما ۲۰,۰۰۰ توکن هدیه میگیرید."
  - Copy link button.

### 4.7 Pricing Page (`/pricing`)
- Display three plans (monthly):
  - **رایگان:** ۵۰,۰۰۰ توکن/ماه, ۰ تومان, دسترسی به ۳ ایجنت پایه, بدون پشتیبانی ویژه.
  - **پایه:** ۵۰۰,۰۰۰ توکن/ماه, ۲۹۰,۰۰۰ تومان/ماه, دسترسی به همه ایجنتها, پشتیبانی استاندارد.
  - **حرفهای:** ۲,۰۰۰,۰۰۰ توکن/ماه, ۹۹۰,۰۰۰ تومان/ماه, همه + ایجنتهای ویژه, پشتیبانی اولویتدار.
- Optional yearly toggle with 20% discount.
- Token top-up packages (one-time):
  - ۱۰۰ هزار توکن = ۵۰,۰۰۰ تومان
  - ۳۰۰ هزار توکن = ۱۳۰,۰۰۰ تومان
  - ۱ میلیون توکن = ۴۰۰,۰۰۰ تومان
- Each plan card has "انتخاب پلن" button; token packages have "خرید" button.
- Payment: For MVP, clicking "خرید" will simulate a successful payment (add tokens, create transaction record). A comment should note that real Zarinpal integration will replace this later. Provide a mock payment confirmation modal.

### 4.8 Admin Panel (`/admin`)
- Protected: only users with `is_admin = true`.
- **Dashboard:** Total sales (Toman), active users, total tokens consumed, revenue by month (simple bar chart).
- **Agents Management:**
  - List all agents in table with actions: edit, disable, delete.
  - Create new agent button.
  - Edit form includes: name, slug (auto), icon, category, price, system prompt, model, temperature, max_tokens, suggested prompts (textarea one per line), welcome message, features (textarea one per line), long description, is_featured, is_active.
- **Users Management:**
  - List users with search, filter by plan.
  - Actions: view details, change plan, reset token balance, ban/unban.
- **Transactions:** List all transactions with user email, type, amount, tokens, status, date. Ability to mark pending as success/fail.
- **Promo Codes:** Create, list, delete. Fields: code, discount percent, max uses, expiry.

## 5. Data Models (Supabase PostgreSQL)

### Tables (all timestamptz default `now()`)

**users** (extends auth.users)
- id: uuid primary key references auth.users(id)
- email: text unique
- full_name: text
- avatar_url: text nullable
- provider: text default 'email'
- token_balance: integer default 50000
- monthly_token_limit: integer default 50000
- plan: text default 'free' (free, basic, pro)
- is_admin: boolean default false
- created_at: timestamptz
- updated_at: timestamptz

**agents**
- id: uuid primary key default gen_random_uuid()
- name: text (e.g., 'معمار بکاند')
- slug: text unique (English slug, e.g., 'backend-architect')
- description: text (one line)
- long_description: text
- features: jsonb (array of strings)
- icon: text (emoji)
- category: text (e.g., 'توسعه', 'داده', 'مارکتینگ', 'کسبوکار', 'طراحی')
- price: integer (Toman)
- system_prompt: text
- model: text default 'claude-3-5-sonnet'
- temperature: float default 0.3
- max_tokens: integer default 4096
- suggested_prompts: jsonb (array of strings)
- welcome_message: text
- rating: float default 4.5
- total_sales: integer default 0
- is_active: boolean default true
- is_featured: boolean default false
- created_at: timestamptz
- updated_at: timestamptz

**conversations**
- id: uuid primary key
- user_id: uuid references users(id) on delete cascade
- agent_id: uuid references agents(id)
- title: text default 'گفتگوی جدید'
- total_tokens: integer default 0
- created_at: timestamptz
- updated_at: timestamptz

**messages**
- id: uuid primary key
- conversation_id: uuid references conversations(id) on delete cascade
- role: text ('user' or 'assistant' or 'system')
- content: text
- tokens: integer default 0
- model: text nullable
- created_at: timestamptz

**token_usage**
- id: uuid primary key
- user_id: uuid references users(id)
- agent_id: uuid references agents(id)
- conversation_id: uuid references conversations(id)
- message_id: uuid references messages(id) nullable
- prompt_tokens: integer
- completion_tokens: integer
- total_tokens: integer
- cost_usd: numeric(10,6) nullable
- created_at: timestamptz

**transactions**
- id: uuid primary key
- user_id: uuid references users(id)
- type: text ('topup', 'subscription', 'purchase', 'refund', 'referral_bonus')
- amount: integer (Toman, positive for credit, negative for debit)
- tokens_added: integer (positive if tokens credited)
- status: text ('pending', 'success', 'failed')
- payment_method: text default 'zarinpal' (or 'mock')
- payment_ref: text nullable
- created_at: timestamptz

**subscriptions**
- id: uuid primary key
- user_id: uuid references users(id)
- plan_id: text (basic, pro)
- status: text ('active', 'cancelled', 'expired')
- started_at: timestamptz
- expires_at: timestamptz
- auto_renew: boolean default false
- created_at: timestamptz

**promo_codes**
- id: uuid primary key
- code: text unique
- discount_percent: integer
- max_uses: integer
- uses: integer default 0
- expires_at: timestamptz
- created_at: timestamptz

**referrals**
- id: uuid primary key
- referrer_user_id: uuid references users(id)
- referred_user_id: uuid references users(id)
- tokens_awarded: integer default 20000
- created_at: timestamptz

**rate_limits**
- id: uuid primary key
- user_id: uuid references users(id)
- window_start: timestamptz default now()
- request_count: integer default 0
- window_type: text ('minute', 'hour', 'day')

**Indexes:** Add indexes on foreign keys and frequently queried columns (user_id, agent_id, created_at).

## 6. Core Functionality and Business Logic

### 6.1 Token Management
- **Signup:** After user confirms email, set `token_balance = 50000`, `monthly_token_limit = 50000`. Show welcome modal.
- **Before each Claude API call:**
  - Check rate limits: if user exceeded 20 req/min, 100 req/hour, 500 req/day, return error "تعداد درخواستهای شما بیش از حد مجاز است. لطفاً کمی صبر کنید."
  - Estimate tokens needed: system prompt length + conversation history (last 10 messages) + max_tokens. If balance < estimated or monthly usage + estimated > monthly_limit, block and show purchase prompt.
- **After API response:**
  - Subtract `total_tokens` from `token_balance`.
  - Insert record in `token_usage` and increment `conversations.total_tokens`.
  - Update `monthly_usage` (compute from token_usage for current month).
- **Low balance alerts:** When balance falls below 20% of monthly limit, show warning banner in chat. Below 10%, show more prominent alert. At 0, block and show modal.
- **Token top-up:** User selects a package, a transaction record is created with status 'success' (for MVP), and tokens are added. Email notification optional.
- **Subscription:** When user subscribes to a plan, create subscription record, update `monthly_token_limit` and `plan`, and set `token_balance` to the plan's monthly allowance (if balance less than that, top up; if more, leave). Monthly reset: a cron job (Edge Function scheduled) should run at start of each month to reset `token_balance` to `monthly_token_limit` for users with active subscriptions, and set free users to 50000. For MVP, you can simulate by a button in admin.

### 6.2 Claude API Integration
- **Supabase Edge Function `chat`:**
  - Input: `{ conversationId, agentId, userMessage }`
  - Steps:
    1. Authenticate user via JWT.
    2. Load agent, conversation, and recent messages (last 10).
    3. Build messages array: system prompt + history + new user message.
    4. Call Claude API with streaming enabled. Use `claude-3-5-sonnet` or agent.model.
    5. Stream response back to client.
    6. After completion, record usage (prompt_tokens, completion_tokens) and update token balance.
  - Environment variable: `ANTHROPIC_API_KEY`.
  - Error handling: if API error, return 500 with Persian error message "خطا در ارتباط با هوش مصنوعی".
- **Streaming:** Use `fetch` with `ReadableStream` on client. On each chunk, append to UI. On stream end, update token balance from response headers or a subsequent call.

### 6.3 Purchase Flow
- **Agent Purchase:**
  - User clicks "خرید" on agent detail.
  - If not logged in: redirect to login with return URL.
  - If logged in: show purchase confirmation modal with price and wallet balance. If balance sufficient (in Toman? No, tokens for purchase? Actually, we are selling agents one-time; payment is in Toman via gateway. For MVP, just simulate payment: create transaction record, mark agent as purchased in a new table `purchased_agents` (see below), increment agent's total_sales.)
- **Add table `purchased_agents`:**
  - id, user_id, agent_id, purchased_at.
  - Unique constraint on (user_id, agent_id).
- **Token Top-up:**
  - User clicks "خرید توکن" in various places.
  - Opens modal with packages.
  - On selection, simulate payment success, add tokens, create transaction.
- **Subscription Purchase:**
  - Similar, but create subscription record and update user plan and limits.
- **Refund:** Not needed for MVP.

### 6.4 Referral System
- When user A invites user B via link `?ref=userA_id`, and user B signs up and verifies email, both receive 20,000 tokens.
- Create row in `referrals` table.
- Update token balances and create transactions of type 'referral_bonus'.
- The referral link should be accessible in dashboard.

### 6.5 Promo Codes
- Admin creates promo code with discount percent.
- At checkout (token top-up or subscription), user can enter code.
- If valid, discount applied to amount; tokens credited full amount, but price reduced.

## 7. Seed Data for Agents

Provide these 6 agents fully in Persian:

### 1) معمار بکاند (Backend Architect)
- **slug:** backend-architect
- **icon:** 🏗️
- **category:** توسعه
- **price:** 49000
- **rating:** 4.8
- **total_sales:** 1234
- **description:** طراحی معماری بکاند و API
- **long_description:** "این ایجنت به شما در طراحی سیستمهای بکاند قوی، انتخاب دیتابیس مناسب، و ساخت APIهای امن و مقیاسپذیر کمک میکند. مناسب برای توسعهدهندگان و استارتاپها."
- **features:** ["طراحی RESTful API", "معماری میکروسرویس", "انتخاب دیتابیس", "امنیت API", "بهینهسازی performance", "Docker و Kubernetes"]
- **system_prompt:** "شما یک معمار ارشد بکاند با ۱۵ سال تجربه هستید. به کاربر در طراحی API، انتخاب دیتابیس، معماری سیستم و امنیت کمک کنید. پاسخها را با جزئیات فنی، مثال کد و بهترین شیوهها ارائه دهید."
- **model:** claude-3-5-sonnet
- **temperature:** 0.3
- **max_tokens:** 4096
- **suggested_prompts:** ["یک API برای فروشگاه آنلاین طراحی کن", "چه دیتابیسی برای اپ شبکه اجتماعی مناسب است؟", "چطور API خود را امن کنم؟", "یک Dockerfile برای اپ Node.js بساز", "تفاوت میکروسرویس و مونولیت چیست؟"]
- **welcome_message:** "سلام! من معمار بکاند هستم. میتونم در طراحی API، انتخاب دیتابیس و معماری سیستم کمکت کنم. چه کاری میخوای انجام بدی؟"

### 2) توسعهدهنده فرانتاند (Frontend Developer)
- **slug:** frontend-developer
- **icon:** 🎨
- **category:** توسعه
- **price:** 39000
- **rating:** 4.6
- **total_sales:** 987
- **description:** ساخت رابط کاربری مدرن و واکنشگرا
- **long_description:** "این ایجنت در ساخت صفحات وب، کامپوننتهای React، و طراحی رابط کاربری با Tailwind کمک میکند. مناسب برای کسانی که میخواهند سایت یا اپلیکیشن زیبا بسازند."
- **features:** ["React و Next.js", "Tailwind CSS", "طراحی ریسپانسیو", "انیمیشن", "فرمها", "بهینهسازی سرعت"]
- **system_prompt:** "شما یک توسعهدهنده ارشد فرانتاند هستید. در نوشتن کد React، Tailwind و طراحی UI کمک کنید. کد تمیز و قابل اجرا بنویسید."
- **model:** claude-3-5-sonnet
- **temperature:** 0.4
- **max_tokens:** 4096
- **suggested_prompts:** ["یک صفحه فرود مدرن بساز", "یک فرم ثبتنام با اعتبارسنجی بساز", "چطور انیمیشن به سایت اضافه کنم؟", "یک navbar ریسپانسیو طراحی کن", "کد Tailwind برای کارت محصول بنویس"]
- **welcome_message:** "سلام! من توسعهدهنده فرانتاند هستم. میتونم در ساخت رابط کاربری، کامپوننتها و صفحات وب کمکت کنم."

### 3) تحلیلگر داده (Data Analyst)
- **slug:** data-analyst
- **icon:** 📊
- **category:** داده
- **price:** 44000
- **rating:** 4.7
- **total_sales:** 856
- **description:** تحلیل دادهها و ساخت گزارش
- **long_description:** "این ایجنت به شما در تحلیل دادهها با Python، SQL و ساخت داشبورد کمک میکند. مناسب برای کسبوکارها که میخواهند از دادههای خود بینش بگیرند."
- **features:** ["تحلیل با Pandas", "نوشتن SQL", "ساخت داشبورد", "تمیزکردن داده", "گزارشگیری"]
- **system_prompt:** "شما یک تحلیلگر داده هستید. با استفاده از Python و SQL به کاربر در تحلیل دادهها کمک کنید. پاسخها را با نمودار و جدول توضیح دهید."
- **model:** claude-3-5-sonnet
- **temperature:** 0.2
- **max_tokens:** 4096
- **suggested_prompts:** ["دادههای فروش من را تحلیل کن", "یک کوئری SQL برای یافتن مشتریان برتر بنویس", "چه متریکهایی را باید پیگیری کنم؟", "یک اسکریپت پایتون برای تمیزکردن CSV بنویس", "یک داشبورد KPI طراحی کن"]
- **welcome_message:** "سلام! من تحلیلگر داده هستم. میتونم در تحلیل دادهها و ساخت گزارش کمکت کنم."

### 4) کپیرایتر (Copywriter)
- **slug:** copywriter
- **icon:** 📝
- **category:** مارکتینگ
- **price:** 29000
- **rating:** 4.5
- **total_sales:** 1543
- **description:** نوشتن متنهای تبلیغاتی و محتوا
- **long_description:** "این ایجنت متنهای تبلیغاتی، پستهای شبکه اجتماعی و ایمیلهای مارکتینگ مینویسد. مناسب برای صاحبان کسبوکار که نیاز به محتوای جذاب دارند."
- **features:** ["متن تبلیغاتی", "پست اینستاگرام", "ایمیل مارکتینگ", "شعار برند", "توضیحات محصول"]
- **system_prompt:** "شما یک کپیرایتر حرفهای هستید. متنهای متقاعدکننده و خلاقانه بنویسید."
- **model:** claude-3-5-haiku (cheaper)
- **temperature:** 0.7
- **max_tokens:** 2048
- **suggested_prompts:** ["یک تبلیغ فیسبوک برای دوره آموزشی بنویس", "۵ کپشن اینستاگرام برای برند مد بنویس", "یک ایمیل معرفی محصول بنویس", "یک شعار برای کافیشاپ بساز", "توضیحات محصول برای فروشگاه بنویس"]
- **welcome_message:** "سلام! من کپیرایتر هستم. میتونم متنهای تبلیغاتی و محتوای شبکه اجتماعی برات بنویسم."

### 5) مشاور استارتاپ (Startup Advisor)
- **slug:** startup-advisor
- **icon:** 🚀
- **category:** کسبوکار
- **price:** 59000
- **rating:** 4.9
- **total_sales:** 643
- **description:** راهنمایی برای رشد و جذب سرمایه
- **long_description:** "این ایجنت به بنیانگذاران استارتاپ در استراتژی، مدل کسبوکار، جذب سرمایه و رشد کمک میکند. مناسب برای کارآفرینان."
- **features:** ["مدل کسبوکار", "استراتژی رشد", "جذب سرمایه", "MVP", "تحلیل بازار"]
- **system_prompt:** "شما یک مشاور استارتاپ با تجربه راهاندازی ۲۰+ استارتاپ هستید. مشاوره عملی و قابل اجرا بدهید."
- **model:** claude-3-5-sonnet
- **temperature:** 0.5
- **max_tokens:** 4096
- **suggested_prompts:** ["چطور MVP بسازم؟", "مدل درآمدی مناسب برای SaaS چیست؟", "چطور سرمایهگذار جذب کنم؟", "یک برنامه رشد ۹۰ روزه بنویس", "چطور بازار را تحلیل کنم؟"]
- **welcome_message:** "سلام! من مشاور استارتاپ هستم. میتونم در استراتژی و رشد کمکت کنم."

### 6) مدیر محصول (Product Manager)
- **slug:** product-manager
- **icon:** 💼
- **category:** کسبوکار
- **price:** 49000
- **rating:** 4.4
- **total_sales:** 789
- **description:** مدیریت محصول و اولویتبندی
- **long_description:** "این ایجنت در نوشتن PRD، ساخت Roadmap و اولویتبندی فیچرها کمک میکند. مناسب برای تیمهای محصول."
- **features:** ["PRD نویسی", "Roadmap", "User Story", "OKR", "اولویتبندی"]
- **system_prompt:** "شما یک مدیر محصول ارشد هستید. به کاربر در تعریف محصول، اولویتبندی و برنامهریزی کمک کنید. خروجیها ساختاریافته باشند."
- **model:** claude-3-5-sonnet
- **temperature:** 0.3
- **max_tokens:** 4096
- **suggested_prompts:** ["یک PRD برای اپ موبایل بنویس", "یک Roadmap سه ماهه بساز", "این فیچرها را اولویتبندی کن", "User Story برای checkout بنویس", "OKR های تیم محصول را تعریف کن"]
- **welcome_message:** "سلام! من مدیر محصول هستم. میتونم در تعریف محصول و برنامهریزی کمکت کنم."

## 8. Additional Features (Implement as specified)

- **Download Chat Transcript:** In chat header, button to download the conversation as a .txt file with all messages and timestamps.
- **Copy Code Button:** In chat, detect code blocks (using simple regex for ```) and add a copy button.
- **Notification Emails:** Use Supabase Auth templates for verification. For low balance, purchase confirmations, etc., implement Edge Functions to send emails via a service like Resend (placeholder: just log or show in-app notification).
- **Dark Mode:** Only dark mode, no toggle.
- **SEO:** Set meta tags in Next.js for each page (title, description, lang="fa").
- **Performance:** Use Next.js Image for icons, lazy load components.

## 9. Edge Cases and Error Handling

- **User not authenticated:** Redirect to login with return URL.
- **Agent not found:** Show 404 page.
- **Conversation deleted:** If user tries to load non-existent conversation, redirect to new chat.
- **API timeout:** Show error "پاسخی دریافت نشد، لطفاً دوباره تلاش کنید."
- **Rate limited:** Show Persian message with retry time.
- **Insufficient tokens:** Show modal as described.
- **Payment failure (mock):** Always simulate success for MVP, but structure code to handle failure.

## 10. Deployment and Environment Variables

- Deploy via Lovable (auto Vercel + Supabase).
- Environment variables required:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (for edge functions)
  - `ANTHROPIC_API_KEY`
  - `ZARINPAL_MERCHANT_ID` (optional, for future real integration)
- Supabase Edge Function `chat` must be created and deployed separately if not auto-generated by Lovable.

## 11. Final Instructions for AI

- **Do not add features beyond what is specified.** Stick to the described pages, components, and logic.
- If any detail is missing, use the most common implementation (e.g., for date formatting, use Persian locale).
- All UI strings must be in Persian as provided; if you need to generate new strings, use natural Persian.
- Ensure the application compiles and runs without errors.
- Use TypeScript types for all data models.
- Provide seed data in a SQL file or via Supabase seed script.
- The result should be a fully functional MVP ready for user testing.

Now build the entire application according to these specifications.