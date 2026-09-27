import { Bot, webhookCallback } from "grammy";

export default {
  async fetch(request, env) {
    const bot = new Bot(env.BOT_TOKEN);

    bot.command("start", async (ctx) => {
      await ctx.reply("Привет! Бот работает!");
    });

    return webhookCallback(bot, "cloudflare-mod")(request);
  },
};
