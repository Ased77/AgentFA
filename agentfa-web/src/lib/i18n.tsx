import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { formatPhone, localizeDigits } from "./phone";
import { faAgents } from "../data/fa-agents";

export type Lang = "fa" | "en";

const STORAGE_KEY = "agentfa-lang";

type Dict = Record<string, string>;

const fa: Dict = {
  "brand.name": "ایجنت‌فا",
  "nav.marketplace": "فروشگاه ایجنت‌ها",
  "nav.pricing": "قیمت‌ها",
  "nav.how": "چطور کار می‌کند",
  "nav.admin": "پنل مدیریت",
  "nav.login": "ورود / ثبت‌نام",
  "nav.dashboard": "داشبورد",
  "nav.logout": "خروج",
  "nav.lang": "زبان",
  "nav.menu": "منو",
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
  "payment.pending": "درخواست پرداخت ثبت شد؛ پس از تأیید درگاه، ایجنت فعال می‌شود.",

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

  "auth.phoneEyebrow": "ورود با شماره موبایل",
  "auth.phoneTitle": "ورود یا ساخت حساب",
  "auth.phoneBody": "شماره موبایلت را وارد کن؛ یک کد ۶ رقمی پیامک می‌شود.",
  "auth.phone": "شماره موبایل",
  "auth.phonePlaceholder": "۰۹۱۲ ۱۲۳ ۴۵۶۷",
  "auth.sendCode": "ارسال کد ورود",
  "auth.sending": "در حال ارسال…",
  "auth.codeTitle": "کد پیامک‌شده را وارد کن",
  "auth.codeSentTo": "کد ۶ رقمی به {phone} پیامک شد؛ تا دو دقیقه معتبر است.",
  "auth.code": "کد ورود",
  "auth.verify": "ورود به حساب",
  "auth.verifying": "در حال بررسی…",
  "auth.resend": "ارسال دوباره کد",
  "auth.resendIn": "ارسال دوباره تا {seconds} ثانیه",
  "auth.changePhone": "تغییر شماره",
  "auth.newAccount": "شماره‌ات جدید است؟ با همین کد حساب ساخته می‌شود و ۵۰٬۰۰۰ توکن هدیه می‌گیری.",
  "auth.welcomeGift": "خوش آمدی! ۵۰٬۰۰۰ توکن هدیه به حساب اضافه شد.",
  "auth.devCode": "حالت توسعه (پیامکی ارسال نشد): کد {code}",
  "auth.secure": "نشست شما توسط سرور AgentFA محافظت می‌شود.",

  "auth.error.generic": "ورود انجام نشد. دوباره تلاش کن.",
  "auth.error.network": "ارتباط با سرور برقرار نشد.",
  "auth.error.phone_required": "شماره موبایل را وارد کن.",

  "auth.error.invalid_phone": "شماره موبایل معتبر نیست. نمونه: ۰۹۱۲۱۲۳۴۵۶۷",
  "auth.error.invalid_code": "کد وارد‌شده درست نیست.",
  "auth.error.code_expired": "این کد منقضی شده است. کد تازه بگیر.",
  "auth.error.too_many_attempts": "کد باطل شد. کد تازه بگیر.",
  "auth.error.rate_limited": "کمی صبر کن و دوباره تلاش کن.",
  "auth.error.sms_failed": "ارسال پیامک ناموفق بود. بعداً تلاش کن.",
  "auth.error.sms_not_configured": "ارسال پیامک روی این سرور تنظیم نشده است.",

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
  "chat.errorTime": "اعتبار زمانی شما کافی نیست. برای ادامه، بسته‌ی زمانی یا پلن بالاتر تهیه کنید.",
  "chat.error.budget": "اعتبار شما در میانه‌ی پاسخ تمام شد؛ متن ناقص نمایش داده شد و مصرف همان بخش محاسبه شد.",
  "chat.error.no_provider": "سرویس‌دهنده‌ی هوش مصنوعی پیکربندی نشده است.",
  "chat.error.not_owned": "برای گفت‌وگو با این ایجنت، ابتدا آن را خریداری کنید.",
  "chat.error.not_covered": "این ایجنت برای سرویس‌دهنده‌ی فعال تعریف نشده است.",
  "chat.error.invalid_key": "کلید سرویس‌دهنده نامعتبر یا منقضی است.",
  "chat.error.rate_limited": "سرویس‌دهنده تعداد درخواست‌ها را محدود کرده است. کمی بعد تلاش کنید.",
  "chat.error.not_found": "مدل یا آدرس سرویس‌دهنده پیدا نشد.",
  "chat.error.network": "ارتباط با سرویس‌دهنده برقرار نشد (شبکه یا محدودیت CORS).",
  "chat.error.server": "سرویس‌دهنده خطای داخلی داد. دوباره تلاش کنید.",
  "chat.error.bad_response": "پاسخ سرویس‌دهنده قابل خواندن نبود.",
  "chat.error.timeout": "پاسخی دریافت نشد، لطفاً دوباره تلاش کنید.",
  "chat.error.aborted": "ارسال پیام لغو شد.",
  "chat.demoMode": "حالت نمایشی",
  "chat.demoNotice": "سرویس‌دهنده‌ی هوش مصنوعی پیکربندی نشده است؛ پاسخ‌ها در حالت نمایشی ساخته می‌شوند.",
  "chat.minutes": "دقیقه",
  "chat.usageTime": "زمان: {minutes} دقیقه",
  "chat.yourTime": "اعتبار زمانی شما",
  "chat.timePasses": "بسته‌های زمانی",
  "chat.lowTime": "اعتبار زمانی شما رو به اتمام است. برای قطع‌نشدن گفت‌وگو، بسته‌ی زمانی تهیه کنید.",
  "chat.lockedTitle": "برای این ایجنت دسترسی ندارید",
  "chat.lockedBody": "گفت‌وگو با ایجنت‌ها فقط پس از خرید ایجنت فعال می‌شود و مصرف از اعتبار توکن یا زمان شما کم می‌شود.",
  "chat.lockedCta": "مشاهده و خرید ایجنت",
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
  "pricing.allowance": "{tokens} توکن و {minutes} دقیقه در ماه",
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

  "admin.provider.title": "سرویس‌دهنده‌ی هوش مصنوعی (غیر از Claude)",
  "admin.provider.body": "یک سرویس‌دهنده‌ی سازگار با OpenAI پیکربندی کنید؛ همه‌ی گفت‌وگوهای ایجنت‌ها از آن عبور می‌کنند و مصرف بر اساس توکن یا زمان، از اعتبار کاربر کم می‌شود.",
  "admin.provider.active": "فعال",
  "admin.provider.disabled": "غیرفعال",
  "admin.provider.label": "نام نمایشی",
  "admin.provider.labelPlaceholder": "مثلاً: گیت‌وی داخلی",
  "admin.provider.baseUrl": "آدرس پایه (Base URL)",
  "admin.provider.model": "نام مدل",
  "admin.provider.key": "کلید API",
  "admin.provider.meter": "مبنای مصرف",
  "admin.provider.meter.tokens": "توکنی",
  "admin.provider.meter.time": "زمانی",
  "admin.provider.rateTokens": "تومان به‌ازای هر ۱۰۰۰ توکن",
  "admin.provider.rateTime": "تومان به‌ازای هر دقیقه",
  "admin.provider.scope": "ایجنت‌های مجاز (شناسه‌ها با کاما)",
  "admin.provider.scopePlaceholder": "خالی = همه‌ی ایجنت‌های خریداری‌شده",
  "admin.provider.scopeAll": "همه‌ی {count} ایجنت فروشگاه",
  "admin.provider.scopeCount": "{count} ایجنت انتخاب‌شده",
  "admin.provider.scopeUnknown": "شناسه‌های ناشناس: {ids}",
  "admin.provider.enabled": "فعال باشد",
  "admin.provider.devProxy": "عبور از پروکسی توسعه (برای CORS)",
  "admin.provider.save": "ذخیره‌ی تنظیمات",
  "admin.provider.saved": "تنظیمات ذخیره شد.",
  "admin.provider.test": "آزمایش اتصال",
  "admin.provider.testing": "در حال آزمایش…",
  "admin.provider.testOk": "اتصال برقرار شد ({model}) — {tokens} توکن در {seconds} ثانیه.",
  "admin.provider.clear": "حذف سرویس‌دهنده",
  "admin.provider.problem.baseUrl": "آدرس پایه را وارد کنید.",
  "admin.provider.problem.scheme": "آدرس باید با http:// یا https:// شروع شود.",
  "admin.provider.problem.model": "نام مدل را وارد کنید.",
  "admin.provider.problem.key": "کلید API را وارد کنید.",
  "admin.provider.problem.scope": "حداقل یک ایجنت مجاز لازم است.",
};

const en: Dict = {
  "brand.name": "AgentFa",
  "nav.marketplace": "Agent Store",
  "nav.pricing": "Pricing",
  "nav.how": "How it works",
  "nav.admin": "Admin",
  "nav.login": "Log in / Sign up",
  "nav.dashboard": "Dashboard",
  "nav.logout": "Log out",
  "nav.lang": "Language",
  "nav.menu": "Menu",
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

  "auth.phoneEyebrow": "Sign in with your mobile",
  "auth.phoneTitle": "Log in or create an account",
  "auth.phoneBody": "Enter your mobile number and we will text you a 6-digit code.",
  "auth.phone": "Mobile number",
  "auth.phonePlaceholder": "0912 123 4567",
  "auth.sendCode": "Send login code",
  "auth.sending": "Sending…",
  "auth.codeTitle": "Enter the code we texted you",
  "auth.codeSentTo": "We texted a 6-digit code to {phone}; it is valid for two minutes.",
  "auth.code": "Login code",
  "auth.verify": "Log in",
  "auth.verifying": "Checking…",
  "auth.resend": "Send a new code",
  "auth.resendIn": "Resend in {seconds}s",
  "auth.changePhone": "Change number",
  "auth.newAccount": "New number? The same code creates your account with 50,000 gift tokens.",
  "auth.welcomeGift": "Welcome! 50,000 gift tokens were added to your account.",
  "auth.devCode": "Development mode (no SMS sent): code {code}",
  "auth.secure": "Your session is protected by the AgentFA server.",

  "auth.error.generic": "We could not sign you in. Please try again.",
  "auth.error.network": "We could not reach the server.",
  "auth.error.phone_required": "Enter your mobile number.",

  "auth.error.invalid_phone": "That is not a valid mobile number. Example: 09121234567",
  "auth.error.invalid_code": "That code is not correct.",
  "auth.error.code_expired": "That code has expired. Request a new one.",
  "auth.error.too_many_attempts": "That code was burned by too many attempts. Request a new one.",
  "auth.error.rate_limited": "Too many requests. Please wait a moment.",
  "auth.error.sms_failed": "We could not send the SMS. Please try again later.",
  "auth.error.sms_not_configured": "SMS delivery is not configured on this server.",

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
  "pricing.allowance": "{tokens} tokens and {minutes} minutes per month",
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
  "chat.errorTime": "Your time allowance is too low. Buy a time pass or upgrade your plan to continue.",
  "chat.error.budget": "Your allowance ran out mid-answer; the partial reply is shown and charged for.",
  "chat.error.no_provider": "No AI provider is configured.",
  "chat.error.not_owned": "Buy this agent before chatting with it.",
  "chat.error.not_covered": "This agent isn't enabled for the active provider.",
  "chat.error.invalid_key": "The provider rejected the API key.",
  "chat.error.rate_limited": "The provider is rate-limiting requests. Try again shortly.",
  "chat.error.not_found": "The provider couldn't find that model or endpoint.",
  "chat.error.network": "Couldn't reach the provider (network or CORS restriction).",
  "chat.error.server": "The provider returned a server error. Please retry.",
  "chat.error.bad_response": "The provider's response couldn't be read.",
  "chat.error.timeout": "No response arrived. Please try again.",
  "chat.error.aborted": "The message was cancelled.",
  "chat.demoMode": "Demo mode",
  "chat.demoNotice": "No AI provider is configured; replies are simulated in demo mode.",
  "chat.minutes": "minutes",
  "chat.usageTime": "Time: {minutes} min",
  "chat.yourTime": "Your time balance",
  "chat.timePasses": "Time passes",
  "chat.lowTime": "Your time allowance is running low. Buy a time pass so the conversation isn't interrupted.",
  "chat.lockedTitle": "You don't have access to this agent",
  "chat.lockedBody": "Agent chats unlock after you buy the agent; usage is deducted from your token or time allowance.",
  "chat.lockedCta": "View and buy this agent",

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

  "admin.provider.title": "AI provider (non-Claude)",
  "admin.provider.body": "Configure one OpenAI-compatible endpoint; every agent chat streams through it and usage is deducted from the user's token or time allowance.",
  "admin.provider.active": "Active",
  "admin.provider.disabled": "Disabled",
  "admin.provider.label": "Display name",
  "admin.provider.labelPlaceholder": "e.g. Internal gateway",
  "admin.provider.baseUrl": "Base URL",
  "admin.provider.model": "Model",
  "admin.provider.key": "API key",
  "admin.provider.meter": "Meter",
  "admin.provider.meter.tokens": "Tokens",
  "admin.provider.meter.time": "Time",
  "admin.provider.rateTokens": "Toman per 1k tokens",
  "admin.provider.rateTime": "Toman per minute",
  "admin.provider.scope": "Allowed agents (comma-separated ids)",
  "admin.provider.scopePlaceholder": "Empty = every purchased agent",
  "admin.provider.scopeAll": "All {count} catalog agents",
  "admin.provider.scopeCount": "{count} agents selected",
  "admin.provider.scopeUnknown": "Unknown ids: {ids}",
  "admin.provider.enabled": "Enabled",
  "admin.provider.devProxy": "Route through the dev proxy (CORS)",
  "admin.provider.save": "Save settings",
  "admin.provider.saved": "Settings saved.",
  "admin.provider.test": "Test connection",
  "admin.provider.testing": "Testing…",
  "admin.provider.testOk": "Connected to {model} — {tokens} tokens in {seconds}s.",
  "admin.provider.clear": "Remove provider",
  "admin.provider.problem.baseUrl": "Enter a base URL.",
  "admin.provider.problem.scheme": "The URL must start with http:// or https://.",
  "admin.provider.problem.model": "Enter a model name.",
  "admin.provider.problem.key": "Enter the API key.",
  "admin.provider.problem.scope": "At least one allowed agent is required.",
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
  /** Mobile number as people write it: `0912 123 4567`, in local digits. */
  phone: (value: string) => string;
  /** Division label for a division record: labelFa in fa, label in en. */
  division: (d: { label: string; labelFa: string }) => string;
  /** Division label for an agent: its localized category in fa, English divisionLabel in en. */
  agentDivision: (a: LocalizableAgent) => string;
  /** Localized agent-card title. */
  agentName: (a: LocalizableAgent) => string;
  /** Localized agent-card summary. */
  agentDescription: (a: LocalizableAgent) => string;
  /** Localized detail-page blurb. */
  agentLongDescription: (a: LocalizableAgent) => string;
  /** Localized "what it does" bullets for the detail page. */
  agentFeatures: (a: LocalizableAgent) => string[];
  /** Localized starter prompts for the detail page and the chat composer. */
  agentPrompts: (a: LocalizableAgent) => string[];
  /** Localized chat greeting, the assistant's first message. */
  agentWelcome: (a: LocalizableAgent) => string;
};

/** The catalog fields the agent i18n helpers read; `CatalogAgent` satisfies it. */
export type LocalizableAgent = {
  id: string;
  name: string;
  category: string;
  divisionLabel: string;
  description: string;
  longDescription: string;
  features: string[];
  prompts: string[];
  welcome: string;
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
    const faCopy = (a: LocalizableAgent) =>
      lang === "fa" ? faAgents[a.id] : undefined;
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
      phone: (value: string) => localizeDigits(formatPhone(value), lang),
      division: (d) => (lang === "fa" ? d.labelFa : d.label),
      agentDivision: (a) => (lang === "fa" ? a.category : a.divisionLabel),
      // The generated catalog is English-only, so Persian copy comes from the
      // per-agent faAgents map. Falling back to the English catalog (rather than
      // a generic "specialized agent in <division>" line) keeps every card
      // distinct even for an agent that has not been translated yet.
      agentName: (a) => faCopy(a)?.name ?? a.name,
      agentDescription: (a) => faCopy(a)?.description ?? a.description,
      agentLongDescription: (a) =>
        faCopy(a)?.longDescription ?? a.longDescription,
      agentFeatures: (a) => faCopy(a)?.features ?? a.features,
      agentPrompts: (a) => faCopy(a)?.prompts ?? a.prompts,
      // The catalog greeting is "سلام! من <English name> هستم. <English tagline>";
      // rebuild it from the localized name and blurb.
      agentWelcome: (a) => {
        const copy = faCopy(a);
        return copy
          ? `سلام! من ${copy.name} هستم. ${copy.longDescription}`
          : a.welcome;
      },
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
