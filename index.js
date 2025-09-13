import 'dotenv/config';
import fs from 'fs';
import { Client, GatewayIntentBits, Partials, ActionRowBuilder, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, Events, EmbedBuilder } from 'discord.js';
import Database from 'better-sqlite3';
import { parse, isValid, addDays, format, isBefore } from 'date-fns';
import { de } from 'date-fns/locale';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const token = process.env.DISCORD_TOKEN;

const db = new Database('./data.sqlite');
setupDatabase();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel]
});

client.once('ready', () => {
  console.log(`Bot ready: ${client.user.tag}`);
  setInterval(checkExpiredStatuses, 60 * 1000); // jede Minute prüfen
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'lefox') {
        const sub = interaction.options.getSubcommand();
        if (sub === 'embed') {
          if (!isManager(interaction.user.id)) {
            return interaction.reply({ content: 'Du bist nicht berechtigt.', ephemeral: true });
          }
          await postOrUpdateEmbed(interaction);
          return interaction.reply({ content: 'Embed gepostet/aktualisiert ✅', ephemeral: true });
        }
        if (sub === 'weekly') {
          if (!isManager(interaction.user.id)) {
            return interaction.reply({ content: 'Nur Manager kann das.', ephemeral: true });
          }
          const report = buildWeeklyReportEmbed();
          return interaction.reply({ embeds: [report], ephemeral: true });
        }
      }
    }
    if (interaction.isStringSelectMenu() && interaction.customId === 'lefox-status-select') {
      const choice = interaction.values[0];
      if (choice === 'aktiv') {
        const modal = new ModalBuilder()
          .setCustomId(`modal-aktiv-${interaction.user.id}`)
          .setTitle('Aktiv - Bis wann?');
        const input = new TextInputBuilder()
          .setCustomId('aktiv-time')
          .setLabel('Bis (z.B. 23:16 oder 20.09.2025 23:16)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
      }
      if (choice === 'inaktiv') {
        setStatus(interaction.user.id, 'inaktiv', { since: new Date().toISOString() });
        await updateEmbedMessageIfExists();
        return interaction.reply({ content: 'Du bist jetzt Inaktiv ✅', ephemeral: true });
      }
      if (choice === 'abgemeldet') {
        const modal = new ModalBuilder()
          .setCustomId(`modal-abgemeldet-${interaction.user.id}`)
          .setTitle('Abmelden');
        const untilInput = new TextInputBuilder()
          .setCustomId('abmeld-datum')
          .setLabel('Bis (z.B. 20.09.2025)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true);
        const reasonInput = new TextInputBuilder()
          .setCustomId('abmeld-grund')
          .setLabel('Grund (optional)')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false);
        modal.addComponents(new ActionRowBuilder().addComponents(untilInput));
        modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        return interaction.showModal(modal);
      }
    }
    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith('modal-aktiv-')) {
        const timeStr = interaction.fields.getTextInputValue('aktiv-time');
        const until = parseDateTime(timeStr);
        if (!until) {
          return interaction.reply({ content: 'Ungültiges Datum/Zeit. Bitte erneut versuchen.', ephemeral: true });
        }
        setStatus(interaction.user.id, 'aktiv', { until: until.toISOString() });
        await updateEmbedMessageIfExists();
        return interaction.reply({ content: `Du bist aktiv bis ${format(until, 'dd.MM.yyyy HH:mm', { locale: de })}`, ephemeral: true });
      }
      if (interaction.customId.startsWith('modal-abgemeldet-')) {
        const untilStr = interaction.fields.getTextInputValue('abmeld-datum');
        const until = parseDateTime(untilStr);
        if (!until) {
          return interaction.reply({ content: 'Ungültiges Datum.', ephemeral: true });
        }
        const grund = interaction.fields.getTextInputValue('abmeld-grund') || '';
        setStatus(interaction.user.id, 'abgemeldet', { until: until.toISOString(), reason: grund });
        await updateEmbedMessageIfExists();
        return interaction.reply({ content: `Abgemeldet bis ${format(until, 'dd.MM.yyyy HH:mm', { locale: de })}${grund ? ` (Grund: ${grund})` : ''}`, ephemeral: true });
      }
    }
  } catch (err) {
    console.error(err);
  }
});

function isManager(id) {
  return id === config.managerId;
}

function setupDatabase() {
  db.prepare(`CREATE TABLE IF NOT EXISTS status (userId TEXT PRIMARY KEY, status TEXT, meta TEXT)`).run();
  db.prepare(`CREATE TABLE IF NOT EXISTS embed_state (id INTEGER PRIMARY KEY, channelId TEXT, messageId TEXT)`).run();
  db.prepare(`CREATE TABLE IF NOT EXISTS activity_log (id INTEGER PRIMARY KEY AUTOINCREMENT, userId TEXT, action TEXT, timestamp TEXT)`).run();
}

function parseDateTime(input) {
  input = input.trim().toLowerCase();
  if (input === 'morgen' || input.startsWith('morgen')) {
    const timePart = input.replace('morgen', '').trim() || '09:00';
    const tomorrow = addDays(new Date(), 1);
    const parsed = parse(`${format(tomorrow, 'dd.MM.yyyy')} ${timePart}`, 'dd.MM.yyyy HH:mm', new Date(), { locale: de });
    return isValid(parsed) ? parsed : null;
  }
  const formats = ['HH:mm', 'dd.MM.yyyy HH:mm', 'dd.MM.yyyy', 'yyyy-MM-dd HH:mm', 'yyyy-MM-dd'];
  for (const f of formats) {
    const parsed = parse(input, f, new Date(), { locale: de });
    if (isValid(parsed)) return parsed;
  }
  return null;
}

function setStatus(userId, status, metaObj = {}) {
  const meta = JSON.stringify(metaObj);
  db.prepare('INSERT INTO status (userId, status, meta) VALUES (?, ?, ?) ON CONFLICT(userId) DO UPDATE SET status=excluded.status, meta=excluded.meta')
    .run(userId, status, meta);
  db.prepare('INSERT INTO activity_log (userId, action, timestamp) VALUES (?, ?, ?)').run(userId, status, new Date().toISOString());
}

function getAllStatuses() {
  const rows = db.prepare('SELECT userId, status, meta FROM status').all();
  const out = {};
  for (const r of rows) out[r.userId] = { status: r.status, meta: JSON.parse(r.meta || '{}') };
  return out;
}

function buildStatusEmbed() {
  const statuses = getAllStatuses();
  const embed = new EmbedBuilder()
    .setTitle('Benutzer-Informationen')
    .setDescription('Bitte tragt euch korrekt ein. Wer wiederholt inaktiv ist → Gespräch mit Rope / ggf. Kick.')
    .setTimestamp();

  for (const member of config.team) {
    const s = statuses[member.id];
    let value = '—';
    if (s) {
      if (s.status === 'aktiv') value = `Aktiv bis ${format(new Date(s.meta.until), 'dd.MM.yyyy HH:mm', { locale: de })}`;
      if (s.status === 'inaktiv') value = `Inaktiv seit ${format(new Date(s.meta.since), 'dd.MM.yyyy HH:mm', { locale: de })}`;
      if (s.status === 'abgemeldet') value = `Abgemeldet bis ${format(new Date(s.meta.until), 'dd.MM.yyyy HH:mm', { locale: de })}${s.meta.reason ? `\nGrund: ${s.meta.reason}` : ''}`;
    }
    embed.addFields({ name: member.name, value });
  }
  return embed;
}

function buildSelectMenu() {
  return [new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('lefox-status-select')
      .setPlaceholder('Wähle deinen Status')
      .addOptions(
        { label: 'Aktiv', value: 'aktiv', description: 'Ich kümmere mich um den Server' },
        { label: 'Inaktiv', value: 'inaktiv', description: 'Ich bin beschäftigt' },
        { label: 'Abmelden', value: 'abgemeldet', description: 'Für längere Zeit abmelden' }
      )
  )];
}

async function postOrUpdateEmbed(interaction) {
  const embed = buildStatusEmbed();
  const rows = buildSelectMenu();
  const state = db.prepare('SELECT channelId, messageId FROM embed_state LIMIT 1').get();
  if (state) {
    try {
      const channel = await interaction.client.channels.fetch(state.channelId);
      const message = await channel.messages.fetch(state.messageId);
      await message.edit({ embeds: [embed], components: rows });
      return;
    } catch {}
  }
  const sent = await interaction.channel.send({ embeds: [embed], components: rows });
  db.prepare('DELETE FROM embed_state').run();
  db.prepare('INSERT INTO embed_state (channelId, messageId) VALUES (?, ?)').run(sent.channel.id, sent.id);
}

async function updateEmbedMessageIfExists() {
  const state = db.prepare('SELECT channelId, messageId FROM embed_state LIMIT 1').get();
  if (!state) return;
  try {
    const channel = await client.channels.fetch(state.channelId);
    const message = await channel.messages.fetch(state.messageId);
    await message.edit({ embeds: [buildStatusEmbed()], components: buildSelectMenu() });
  } catch {}
}

function checkExpiredStatuses() {
  const statuses = getAllStatuses();
  const now = new Date();
  for (const [uid, s] of Object.entries(statuses)) {
    if (s.status === 'aktiv' && s.meta.until) {
      const until = new Date(s.meta.until);
      if (isBefore(until, now)) {
        setStatus(uid, 'inaktiv', { since: now.toISOString() });
      }
    }
  }
  updateEmbedMessageIfExists();
}

function buildWeeklyReportEmbed() {
  const since = addDays(new Date(), -7).toISOString();
  const rows = db.prepare('SELECT userId, action FROM activity_log WHERE timestamp >= ?').all(since);
  const counts = {};
  for (const r of rows) {
    counts[r.userId] = counts[r.userId] || { aktiv: 0, inaktiv: 0, abgemeldet: 0 };
    counts[r.userId][r.action] = (counts[r.userId][r.action] || 0) + 1;
  }
  const embed = new EmbedBuilder()
    .setTitle('📊 Wochenreport')
    .setDescription('Letzte 7 Tage Status-Aktivitäten')
    .setTimestamp();

  for (const m of config.team) {
    const c = counts[m.id] || { aktiv: 0, inaktiv: 0, abgemeldet: 0 };
    const total = c.aktiv + c.inaktiv + c.abgemeldet;
    const aktivPct = total ? Math.round((c.aktiv / total) * 100) : 0;
    embed.addFields({
      name: m.name,
      value: `Aktiv: ${c.aktiv}x\nInaktiv: ${c.inaktiv}x\nAbgemeldet: ${c.abgemeldet}x\nAktivitätsquote: ${aktivPct}%`
    });
  }
  return embed;
}

client.login(token);
