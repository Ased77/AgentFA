import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Lang = "fa" | "en";

const STORAGE_KEY = "agentfa-lang";

type Dict = Record<string, string>;

const fa: Dict = {
  "brand.name": "ایجنت‌فا",
  "nav.marketplace": "فروشگاه ایجنت‌ها",
  "nav.pricing": "قیمت‌ها",
  "nav.how": "چطور کار می‌کند",
  "nav.admin": "پنل مدیریت",
  "nav.login": "ورود",
  "nav.signup": "شروع رایگان",
  "nav.dashboard": "داشبورد",
  "nav.lang": "زبان",
  "footer.tagline": "دستیارهای هوشمند، برای کارهای واقعی",

  "common.back": "بازگشت",
  "common.view": "مشاهده",
  "common.startChat": "شروع چت",
  "common.buy": "خرید ایجنت",
  "common.owned": "ایجنت با موفقیت به کتابخانه‌ی شما اضافه شد.",
  "common.bestSeller": "پرفروش",
  "common.sales": "فروش",
  "common.month": "ماه",
  "common.all": "همه",
  "common.token": "توکن",
  "common.toman": "تومان",
  "common.loading": "در حال بارگذاری…",
  "common.copy": "کپی کد",
  "common.delete": "پاک کردن",

  "landing.eyebrow": "بازار ایجنت‌های تخصصی فارسی",
  "landing.title1": "دستیارهای هوش مصنوعی",
  "landing.title2": "که واقعاً کارهات رو انجام می‌دن",
  "landing.subtitle": "به ایجنت‌های تخصصی دسترسی پیدا کن، آن‌ها را برای همیشه داشته باش و برای هر تصمیم سخت، یک هم‌تیمی حرفه‌ای کنار خودت داشته باش.",
  "landing.cta": "شروع رایگان — ۵۰٬۰۰۰ توکن هدیه",
  "landing.seeAgents": "دیدن ایجنت‌ها",
  "landing.noCard": "بدون نیاز به کارت بانکی",
  "landing.fluent": "پاسخ فارسی روان",
  "landing.oneTime": "خرید یک‌باره",
  "landing.findTitle": "ایجنت مناسب را پیدا کن",
  "landing.findEyebrow": "برای کارهای واقعی",
  "landing.seeAll": "مشاهده همه",
  "landing.howEyebrow": "ساده، سریع، بی‌دردسر",
  "landing.howTitle": "از ایده تا نتیجه، در سه قدم",
  "landing.step1t": "ثبت‌نام کن",
  "landing.step1d": "۵۰٬۰۰۰ توکن هدیه بگیر و آماده شو.",
  "landing.step2t": "ایجنتت را انتخاب کن",
  "landing.step2d": "متخصصی که دقیقاً برای کارت ساخته شده.",
  "landing.step3t": "چت کن، نتیجه بگیر",
  "landing.step3d": "با گفت‌وگوی طبیعی، کار را جلو ببر.",

  "market.eyebrow": "بازار تخصص",
  "market.title1": "ایجنتی برای هر",
  "market.title2": "هدف",
  "market.search": "جست‌وجو بین ایجنت‌ها…",
  "market.sort.popular": "محبوب‌ترین",
  "market.sort.cheap": "ارزان‌ترین",
  "market.sort.expensive": "گران‌ترین",
  "market.empty": "هیچ ایجنتی مطابق جست‌وجو یافت نشد.",
  "market.count": "{count} ایجنت",

  "detail.back": "بازگشت به فروشگاه",
  "detail.whatItDoes": "چه کارهایی انجام می‌دهد؟",
  "detail.startHere": "از اینجا شروع کن",
  "detail.guarantee": "ضمانت بازگشت وجه ۷ روزه",
  "detail.lifetime": "دسترسی همیشگی به این ایجنت",

  "auth.welcome": "به ایجنت‌فا خوش آمدید",
  "auth.signupTitle": "حساب جدید بساز",
  "auth.loginTitle": "دوباره خوش آمدی",
  "auth.fullName": "نام کامل",
  "auth.email": "ایمیل",
  "auth.password": "رمز عبور",
  "auth.confirmPassword": "تکرار رمز عبور",
  "auth.signupBtn": "ثبت‌نام",
  "auth.loginBtn": "ورود به حساب",
  "auth.google": "ورود با گوگل",
  "auth.forgot": "فراموشی رمز عبور؟",
  "auth.haveAccount": "حساب داری؟",
  "auth.noAccount": "حساب نداری؟",
  "auth.enter": "وارد شو",
  "auth.join": "ثبت‌نام کن",
  "auth.giftTitle": "هدیه‌ات آماده است!",
  "auth.giftBody": "۵۰٬۰۰۰ توکن هدیه به حساب شما اضافه شد!",
  "auth.giftClose": "شروع کن",

  "verify.title": "ایمیل تأیید را بررسی کنید",
  "verify.body": "ایمیلی برای تأیید حساب شما ارسال شد. لطفاً لینک موجود در ایمیل را کلیک کنید.",
  "verify.resend": "ارسال مجدد ایمیل",

  "reset.title": "بازیابی رمز عبور",
  "reset.body": "ایمیل خود را وارد کنید تا لینک تغییر رمز برایتان ارسال شود.",
  "reset.btn": "ارسال لینک بازیابی",
  "reset.sent": "اگر حسابی با این ایمیل وجود داشته باشد، لینک ارسال شد.",

  "dash.eyebrow": "فضای کاری شما",
  "dash.hello": "سلام، {name}!",
  "dash.friend": "دوست عزیز",
  "dash.balance": "موجودی توکن",
  "dash.myAgents": "ایجنت‌های من",
  "dash.chats": "گفتگوهای این ماه",
  "dash.usage": "مصرف ۳۰ روز اخیر",
  "dash.ready": "آماده‌ای بیشتر بسازی؟",
  "dash.readyBody": "یک ایجنت جدید به تیم کارت اضافه کن.",
  "dash.goShop": "رفتن به فروشگاه",
  "dash.manage": "مدیریت",
  "dash.empty": "هنوز ایجنتی نخریده‌اید.",
  "dash.start": "شروع کنید",

  "chat.notFound": "ایجنت پیدا نشد",
  "chat.download": "دانلود گفتگو",
  "chat.placeholder": "پیام خود را بنویسید…",
  "chat.send": "ارسال",
  "chat.mockReply": "این پاسخ در حالت نمایشی تولید شده است. در اتصال واقعی، متن به‌صورت استریم از Edge Function دریافت می‌شود.",
  "chat.errorRequests": "تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً کمی صبر کنید.",
  "chat.errorBalance": "اعتبار توکن شما کافی نیست. برای ادامه، بسته‌ی توکن تهیه کنید.",
  "chat.buyTokens": "خرید توکن",
  "chat.wallet": "کیف توکن",
  "chat.now": "همین حالا",
  "chat.you": "شما",

  "pricing.eyebrow": "برای هر سرعتی از رشد",
  "pricing.title1": "پلنی که با شما",
  "pricing.title2": "رشد می‌کند",
  "pricing.body": "هر زمان خواستید پلنتان را تغییر دهید. پرداخت‌ها در نسخه‌ی MVP شبیه‌سازی می‌شوند.",
  "pricing.yearly": "پرداخت سالانه",
  "pricing.discount": "۲۰٪ تخفیف",
  "pricing.free": "رایگان",
  "pricing.perMonth": "/ ماه",
  "pricing.tokensPerMonth": "{tokens} توکن در ماه",
  "pricing.choose": "انتخاب پلن",
  "pricing.featured": "پیشنهاد ایجنت‌فا",
  "pricing.onetime": "خرید یک‌باره",
  "pricing.bundles": "بسته‌های توکن",
  "pricing.buy": "خرید",
  "pricing.active": "پلن {name} با موفقیت فعال شد.",
  "pricing.added": "{tokens} توکن اضافه شد.",

  "admin.title": "پنل مدیریت",
  "admin.body": "نمای کلی سیستم و داده‌های نمایشی.",
  "admin.agents": "ایجنت‌ها",
  "admin.divisions": "دسته‌ها",
  "admin.featured": "ویژه",
  "admin.revenue": "درآمد نمایشی",
  "admin.byDivision": "ایجنت‌ها به تفکیک دسته",

  "landing.faqEyebrow": "شفاف و روشن",
  "landing.faqTitle": "سوالات متداول",
  "landing.faqQ1": "ایجنت هوش مصنوعی چیست؟",
  "landing.faqQ2": "هزینه استفاده چطور محاسبه می‌شود؟",
  "landing.faqQ3": "آیا به دانش فنی نیاز دارم؟",
  "landing.faqQ4": "چطور توکن بیشتری بخرم؟",
  "landing.faqA": "هر ایجنت برای یک مسئله مشخص آموزش دیده است. پس از خرید، مصرف شما فقط بر اساس توکن‌های گفت‌وگو محاسبه می‌شود.",
  "detail.preview": "پیش‌نمایش رایگان",
  "auth.goDashboard": "رفتن به داشبورد",
  "titles.home": "ایجنت‌های هوش مصنوعی فارسی",
  "titles.marketplace": "فروشگاه",
  "titles.pricing": "قیمت‌ها",
  "titles.admin": "مدیریت",
  "titles.signup": "ثبت‌نام",
  "titles.login": "ورود",
  "titles.verify": "تأیید",
  "titles.reset": "بازیابی",
  "titles.chat": "گفت‌وگو با ایجنت",
  "titles.account": "حساب کاربری",

  "plan.free": "رایگان",
  "plan.basic": "پایه",
  "plan.pro": "حرفه‌ای",
  "plan.free.f1": "دسترسی به ۳ ایجنت پایه",
  "plan.free.f2": "بدون پشتیبانی ویژه",
  "plan.basic.f1": "دسترسی به همه ایجنت‌ها",
  "plan.basic.f2": "پشتیبانی استاندارد",
  "plan.pro.f1": "همه + ایجنت‌های ویژه",
  "plan.pro.f2": "پشتیبانی اولویت‌دار",
  "pricing.success": "پرداخت موفق بود",
  "pricing.gotIt": "متوجه شدم",
  "pricing.tokensBundle": "{tokens} توکن",

  "chat.newChat": "+ گفت‌وگوی جدید",
  "chat.agentChats": "گفتگوهای این ایجنت",
  "chat.newChatTitle": "گفتگوی جدید",
  "chat.online": "آنلاین",
  "chat.clearChat": "پاک کردن گفتگو",
  "chat.lowBalance": "موجودی توکن شما رو به اتمام است. برای جلوگیری از توقف گفتگو، اعتبار خود را افزایش دهید.",
  "chat.usagePrefix": "مصرف: {tokens} توکن",
  "chat.inputPlaceholder": "پیامت را بنویس…",
  "chat.thisChatUsage": "مصرف این گفتگو",
  "chat.yourBalance": "موجودی توکن شما",
  "chat.buyMore": "خرید توکن بیشتر",
  "chat.upgrade": "ارتقا پلن",
  "chat.attach": "پیوست غیرفعال",
  "chat.chooseBundle": "بسته‌ی موردنظر را انتخاب کنید؛ پرداخت در MVP با موفقیت شبیه‌سازی می‌شود.",

  "admin.eyebrow": "مدیریت سیستم",
  "admin.pageTitle": "پنل ادمین",
  "admin.totalSales": "فروش کل",
  "admin.activeUsers": "کاربر فعال",
  "admin.tokensUsed": "توکن مصرف‌شده",
  "admin.manageAgents": "مدیریت ایجنت‌ها",
  "admin.createAgent": "ایجاد ایجنت",
  "admin.col.agent": "ایجنت",
  "admin.col.category": "دسته",
  "admin.col.price": "قیمت",
  "admin.col.sales": "فروش",
  "admin.col.actions": "عملیات",
  "admin.edit": "ویرایش",
  "admin.disable": "غیرفعال",
  "admin.discountCodes": "کدهای تخفیف",
  "admin.discountBody": "ایجاد و اعمال کدهای تخفیف پس از اتصال دیتابیس پایدار می‌شود.",
  "admin.createCode": "ایجاد کد جدید",
};

const en: Dict = {
  "brand.name": "AgentFa",
  "nav.marketplace": "Agent Store",
  "nav.pricing": "Pricing",
  "nav.how": "How it works",
  "nav.admin": "Admin",
  "nav.login": "Log in",
  "nav.signup": "Start free",
  "nav.dashboard": "Dashboard",
  "nav.lang": "Language",
  "footer.tagline": "Smart assistants, for real work",

  "common.back": "Back",
  "common.view": "View",
  "common.startChat": "Start chat",
  "common.buy": "Buy agent",
  "common.owned": "The agent was added to your library.",
  "common.bestSeller": "Best seller",
  "common.sales": "sales",
  "common.month": "mo",
  "common.all": "All",
  "common.token": "tokens",
  "common.toman": "Toman",
  "common.loading": "Loading…",
  "common.copy": "Copy code",
  "common.delete": "Clear",

  "landing.eyebrow": "Specialized AI agents marketplace",
  "landing.title1": "AI assistants that",
  "landing.title2": "actually get the work done",
  "landing.subtitle": "Get access to specialized agents, keep them forever, and have a professional teammate beside you for every hard decision.",
  "landing.cta": "Start free — 50,000 token gift",
  "landing.seeAgents": "See agents",
  "landing.noCard": "No bank card required",
  "landing.fluent": "Natural responses",
  "landing.oneTime": "One-time purchase",
  "landing.findTitle": "Find the right agent",
  "landing.findEyebrow": "For real work",
  "landing.seeAll": "See all",
  "landing.howEyebrow": "Simple, fast, painless",
  "landing.howTitle": "From idea to result, in three steps",
  "landing.step1t": "Sign up",
  "landing.step1d": "Get a 50,000 token gift and get ready.",
  "landing.step2t": "Pick your agent",
  "landing.step2d": "A specialist built exactly for your job.",
  "landing.step3t": "Chat and get results",
  "landing.step3d": "Move the work forward with natural conversation.",

  "market.eyebrow": "Expertise market",
  "market.title1": "An agent for every",
  "market.title2": "goal",
  "market.search": "Search agents…",
  "market.sort.popular": "Most popular",
  "market.sort.cheap": "Cheapest",
  "market.sort.expensive": "Most expensive",
  "market.empty": "No agents match your search.",
  "market.count": "{count} agents",

  "detail.back": "Back to store",
  "detail.whatItDoes": "What does it do?",
  "detail.startHere": "Start here",
  "detail.guarantee": "7-day money-back guarantee",
  "detail.lifetime": "Lifetime access to this agent",

  "auth.welcome": "Welcome to AgentFa",
  "auth.signupTitle": "Create a new account",
  "auth.loginTitle": "Welcome back",
  "auth.fullName": "Full name",
  "auth.email": "Email",
  "auth.password": "Password",
  "auth.confirmPassword": "Confirm password",
  "auth.signupBtn": "Sign up",
  "auth.loginBtn": "Log in",
  "auth.google": "Continue with Google",
  "auth.forgot": "Forgot password?",
  "auth.haveAccount": "Have an account?",
  "auth.noAccount": "No account?",
  "auth.enter": "Log in",
  "auth.join": "Sign up",
  "auth.giftTitle": "Your gift is ready!",
  "auth.giftBody": "50,000 gift tokens were added to your account!",
  "auth.giftClose": "Get started",

  "verify.title": "Check your email",
  "verify.body": "A verification email was sent. Please click the link in the email.",
  "verify.resend": "Resend email",

  "reset.title": "Reset password",
  "reset.body": "Enter your email and we will send you a reset link.",
  "reset.btn": "Send reset link",
  "reset.sent": "If an account exists for this email, a link was sent.",

  "dash.eyebrow": "Your workspace",
  "dash.hello": "Hi, {name}!",
  "dash.friend": "friend",
  "dash.balance": "Token balance",
  "dash.myAgents": "My agents",
  "dash.chats": "Chats this month",
  "dash.usage": "Last 30 days usage",
  "dash.ready": "Ready to build more?",
  "dash.readyBody": "Add a new agent to your team.",
  "dash.goShop": "Go to store",
  "dash.manage": "Manage",
  "dash.empty": "You have not bought any agent yet.",
  "dash.start": "Get started",

  "chat.notFound": "Agent not found",
  "chat.download": "Download chat",
  "chat.placeholder": "Write your message…",
  "chat.send": "Send",
  "chat.mockReply": "This reply is generated in demo mode. In a real integration the text is streamed from an Edge Function.",
  "chat.errorRequests": "You have exceeded the allowed request rate. Please wait a moment.",
  "chat.errorBalance": "You do not have enough tokens. Buy a token bundle to continue.",
  "chat.buyTokens": "Buy tokens",
  "chat.wallet": "Token wallet",
  "chat.now": "just now",
  "chat.you": "You",

  "pricing.eyebrow": "For every growth speed",
  "pricing.title1": "A plan that grows",
  "pricing.title2": "with you",
  "pricing.body": "Change your plan anytime. Payments are simulated in the MVP.",
  "pricing.yearly": "Yearly billing",
  "pricing.discount": "20% off",
  "pricing.free": "Free",
  "pricing.perMonth": "/ mo",
  "pricing.tokensPerMonth": "{tokens} tokens per month",
  "pricing.choose": "Choose plan",
  "pricing.featured": "AgentFa pick",
  "pricing.onetime": "One-time purchase",
  "pricing.bundles": "Token bundles",
  "pricing.buy": "Buy",
  "pricing.active": "Plan {name} activated.",
  "pricing.added": "{tokens} tokens added.",

  "admin.title": "Admin panel",
  "admin.body": "System overview and demo data.",
  "admin.agents": "Agents",
  "admin.divisions": "Divisions",
  "admin.featured": "Featured",
  "admin.revenue": "Demo revenue",
  "admin.byDivision": "Agents by division",

  "landing.faqEyebrow": "Clear and simple",
  "landing.faqTitle": "Frequently asked questions",
  "landing.faqQ1": "What is an AI agent?",
  "landing.faqQ2": "How is usage priced?",
  "landing.faqQ3": "Do I need technical knowledge?",
  "landing.faqQ4": "How do I buy more tokens?",
  "landing.faqA": "Each agent is trained for a specific problem. After purchase, you are only charged based on the tokens used in conversation.",
  "detail.preview": "Free preview",
  "auth.goDashboard": "Go to dashboard",
  "titles.home": "Persian AI agents",
  "titles.marketplace": "Marketplace",
  "titles.pricing": "Pricing",
  "titles.admin": "Admin",
  "titles.signup": "Sign up",
  "titles.login": "Log in",
  "titles.verify": "Verify",
  "titles.reset": "Reset password",
  "titles.chat": "Chat with agent",
  "titles.account": "Account",

  "plan.free": "Free",
  "plan.basic": "Basic",
  "plan.pro": "Pro",
  "plan.free.f1": "Access to 3 base agents",
  "plan.free.f2": "No priority support",
  "plan.basic.f1": "Access to all agents",
  "plan.basic.f2": "Standard support",
  "plan.pro.f1": "Everything + premium agents",
  "plan.pro.f2": "Priority support",
  "pricing.success": "Payment successful",
  "pricing.gotIt": "Got it",
  "pricing.tokensBundle": "{tokens} tokens",

  "chat.newChat": "+ New chat",
  "chat.agentChats": "This agent's chats",
  "chat.newChatTitle": "New chat",
  "chat.online": "Online",
  "chat.clearChat": "Clear chat",
  "chat.lowBalance": "Your token balance is running low. Top up to avoid interrupting the conversation.",
  "chat.usagePrefix": "Used: {tokens} tokens",
  "chat.inputPlaceholder": "Write your message…",
  "chat.thisChatUsage": "This chat's usage",
  "chat.yourBalance": "Your token balance",
  "chat.buyMore": "Buy more tokens",
  "chat.upgrade": "Upgrade plan",
  "chat.attach": "Attachments disabled",
  "chat.chooseBundle": "Pick a bundle; payment is simulated successfully in the MVP.",

  "admin.eyebrow": "System management",
  "admin.pageTitle": "Admin panel",
  "admin.totalSales": "Total sales",
  "admin.activeUsers": "Active users",
  "admin.tokensUsed": "Tokens used",
  "admin.manageAgents": "Manage agents",
  "admin.createAgent": "Create agent",
  "admin.col.agent": "Agent",
  "admin.col.category": "Division",
  "admin.col.price": "Price",
  "admin.col.sales": "Sales",
  "admin.col.actions": "Actions",
  "admin.edit": "Edit",
  "admin.disable": "Disable",
  "admin.discountCodes": "Discount codes",
  "admin.discountBody": "Creating and applying discount codes will be enabled once a persistent database is connected.",
  "admin.createCode": "Create new code",
};

const dicts: Record<Lang, Dict> = { fa, en };

type I18nValue = {
  lang: Lang;
  dir: "rtl" | "ltr";
  isRtl: boolean;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Locale-aware number formatting (Persian digits in fa, grouped in en). */
  n: (value: number) => string;
  /** Locale-aware currency (Toman). */
  toman: (value: number) => string;
  /** Division label for a division record: labelFa in fa, label in en. */
  division: (d: { label: string; labelFa: string }) => string;
  /** Division label for an agent: its localized category in fa, English divisionLabel in en. */
  agentDivision: (a: { category: string; divisionLabel: string }) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

function detectLang(): Lang {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "fa" || saved === "en") return saved;
  }
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fa")) {
    return "fa";
  }
  return "fa";
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => String(vars[k] ?? m));
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => detectLang());

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === "fa" ? "rtl" : "ltr";
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, l);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = dicts[lang];
    const locale = lang === "fa" ? "fa-IR" : "en-US";
    const t = (key: string, vars?: Record<string, string | number>) =>
      interpolate(dict[key] ?? dicts.en[key] ?? key, vars);
    return {
      lang,
      dir: lang === "fa" ? "rtl" : "ltr",
      isRtl: lang === "fa",
      setLang,
      t,
      n: (v: number) => v.toLocaleString(locale),
      toman: (v: number) => (lang === "fa" ? `${v.toLocaleString("fa-IR")} تومان` : `${v.toLocaleString("en-US")} Toman`),
      division: (d) => (lang === "fa" ? d.labelFa : d.label),
      agentDivision: (a) => (lang === "fa" ? a.category : a.divisionLabel),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}