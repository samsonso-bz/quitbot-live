import { Bot, webhookCallback, InlineKeyboard } from "grammy/web";

// ============ ПРОГРЕСС ============
function calcProgress(user) {
  const quitDate = new Date(user.quit_date);
  const now = new Date();
  const diffMs = now - quitDate;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);

  const cigsPerDay = user.cigs_per_day || 0;
  const packPrice = user.pack_price || 0;

  const packs = (cigsPerDay / 20) * (days + hours / 24);
  const moneySaved = Math.round(packs * packPrice);
  const cigsNotSmoked = Math.round(cigsPerDay * (days + hours / 24));

  return { days, hours, moneySaved, cigsNotSmoked };
}

function formatProgress(user) {
  const { days, hours, moneySaved, cigsNotSmoked } = calcProgress(user);
  return (
    `📊 Твой прогресс\n\n` +
    `🗓 Не куришь: ${days} дн. ${hours} ч.\n` +
    `💰 Сэкономил: ${moneySaved.toLocaleString('ru-RU')} ₽\n` +
    `🚭 Не выкурено: ${cigsNotSmoked} сигарет`
  );
}

function mainMenu() {
  return new InlineKeyboard()
    .text("📊 Прогресс", "stats").row()
    .text("🆘 SOS — тянет курить", "sos").row()
    .text("⚙️ Настройки", "settings");
}

// ============ БОТ ============
export default {
  async fetch(request, env) {
    const bot = new Bot(env.BOT_TOKEN);

    // ---------- /start ----------
    bot.command("start", async (ctx) => {
      const userId = ctx.from.id;
      const user = await env.QUITBOT_KV.get(`user:${userId}`, "json");

      // Уже есть — показываем меню
      if (user && user.quit_date) {
        await ctx.reply(
          `С возвращением! 👋\n\n${formatProgress(user)}`,
          { reply_markup: mainMenu() }
        );
        return;
      }

      // Новый — начинаем онбординг
      const kb = new InlineKeyboard()
        .text("🎯 Прямо сейчас", "quit_now").row()
        .text("📅 Указать дату", "quit_date").row()
        .text("⏳ Только планирую", "quit_date");

      await ctx.reply(
        `Привет! 👋\n\n` +
        `Я помогу тебе бросить курить. Не буду читать нотации —\n` +
        `просто буду рядом, буду считать твой прогресс.\n\n` +
        `Когда ты бросил?`,
        { reply_markup: kb }
      );
    });

    // ---------- Онбординг: кнопки ----------
    bot.callbackQuery("quit_now", async (ctx) => {
      const userId = ctx.from.id;
      await env.QUITBOT_KV.put(`user:${userId}:temp_date`, new Date().toISOString());
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("Сколько сигарет в день ты выкуривал(а)?");
    });

    bot.callbackQuery("quit_date", async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        "Напиши дату в формате ГГГГ-ММ-ДД,\nнапример 2025-01-15"
      );
    });

    // ---------- Онбординг: ввод текста ----------
    bot.on("message:text", async (ctx) => {
      const userId = ctx.from.id;
      const text = ctx.message.text.trim();
      const user = await env.QUITBOT_KV.get(`user:${userId}`, "json");

      // Уже прошёл онбординг — не мешаем
      if (user && user.quit_date) return;

      const tempDate = await env.QUITBOT_KV.get(`user:${userId}:temp_date`);
      const tempCigs = await env.QUITBOT_KV.get(`user:${userId}:temp_cigs`);
      const tempPrice = await env.QUITBOT_KV.get(`user:${userId}:temp_price`);

      // Шаг 1: дата
      if (!tempDate) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
          const d = new Date(text);
          if (isNaN(d.getTime())) {
            await ctx.reply("Не получилось. Формат: ГГГГ-ММ-ДД, например 2025-01-15");
            return;
          }
          await env.QUITBOT_KV.put(`user:${userId}:temp_date`, d.toISOString());
          await ctx.reply("Записал! Сколько сигарет в день ты выкуривал(а)?");
        } else {
          await ctx.reply("Напиши дату в формате ГГГГ-ММ-ДД, например 2025-01-15");
        }
        return;
      }

      // Шаг 2: количество сигарет
      if (tempDate && !tempCigs) {
        if (/^\d+$/.test(text)) {
          await env.QUITBOT_KV.put(`user:${userId}:temp_cigs`, text);
          await ctx.reply("Ок! Сколько стоит пачка? (число в рублях)");
        } else {
          await ctx.reply("Введи просто число, например 20");
        }
        return;
      }

      // Шаг 3: цена пачки
      if (tempDate && tempCigs && !tempPrice) {
        if (/^\d+([.,]\d+)?$/.test(text)) {
          const newUser = {
            quit_date: tempDate,
            cigs_per_day: parseInt(tempCigs),
            pack_price: parseFloat(text.replace(",", ".")),
            created_at: new Date().toISOString(),
          };
          await env.QUITBOT_KV.put(`user:${userId}`, JSON.stringify(newUser));
          await env.QUITBOT_KV.delete(`user:${userId}:temp_date`);
          await env.QUITBOT_KV.delete(`user:${userId}:temp_cigs`);

          await ctx.reply(
            `Всё готово! 🎉\n\n` +
            `${formatProgress(newUser)}\n\n` +
            `Каждый день буду присылать прогресс.\n` +
            `Если будет тяжко — жми 🆘 SOS.\n\n` +
            `Ты справишься. Я в тебя верю 💚`,
            { reply_markup: mainMenu() }
          );
        } else {
          await ctx.reply("Введи число, например 200");
        }
      }
    });

    // ---------- Прогресс ----------
    bot.callbackQuery("stats", async (ctx) => {
      const userId = ctx.from.id;
      const user = await env.QUITBOT_KV.get(`user:${userId}`, "json");
      if (!user) {
        await ctx.answerCallbackQuery("Сначала пройди /start", { show_alert: true });
        return;
      }
      const kb = new InlineKeyboard()
        .text("🔄 Обновить", "stats").row()
        .text("⬅️ В меню", "menu");
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(formatProgress(user), { reply_markup: kb });
    });

    // ---------- SOS ----------
    bot.callbackQuery("sos", async (ctx) => {
      const kb = new InlineKeyboard()
        .text("🫁 Дыхание 4-7-8", "sos_breath").row()
        .text("⏱ Таймер 5 минут", "sos_timer").row()
        .text("⬅️ В меню", "menu");
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        `🆘 Держись! Тяга обычно длится 3-5 минут.\n\nЧто тебе сейчас поможет?`,
        { reply_markup: kb }
      );
    });

    bot.callbackQuery("sos_breath", async (ctx) => {
      const kb = new InlineKeyboard().text("⬅️ Назад", "sos");
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        `🫁 Дыхание 4-7-8\n\n` +
        `1. Вдох через нос — 4 секунды\n` +
        `2. Задержка — 7 секунд\n` +
        `3. Выдох через рот — 8 секунд\n` +
        `4. Повтори 4 раза\n\n` +
        `Начинай прямо сейчас. Я подожду 💚`,
        { reply_markup: kb }
      );
    });

    bot.callbackQuery("sos_timer", async (ctx) => {
      const kb = new InlineKeyboard().text("⬅️ Назад", "sos");
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        `⏱ Просто дыши 5 минут.\n\n` +
        `Тяга пиковая сейчас. Через 5 минут станет легче. Обещаю.\n\n` +
        `Ты справляешься 💚`,
        { reply_markup: kb }
      );
    });

    // ---------- Настройки ----------
    bot.callbackQuery("settings", async (ctx) => {
      const kb = new InlineKeyboard().text("⬅️ В меню", "menu");
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(
        `⚙️ Настройки\n\nПока тут пусто. Скоро добавим уведомления.`,
        { reply_markup: kb }
      );
    });

    // ---------- Возврат в меню ----------
    bot.callbackQuery("menu", async (ctx) => {
      const userId = ctx.from.id;
      const user = await env.QUITBOT_KV.get(`user:${userId}`, "json");
      await ctx.answerCallbackQuery();
      if (!user) {
        await ctx.editMessageText("Напиши /start, чтобы начать.");
        return;
      }
      await ctx.editMessageText(formatProgress(user), { reply_markup: mainMenu() });
    });

    // ---------- Запуск ----------
    return webhookCallback(bot, "cloudflare-mod")(request);
  },
};
