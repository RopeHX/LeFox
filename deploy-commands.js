import 'dotenv/config';
import { REST, Routes, ApplicationCommandOptionType } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

const commands = [
  {
    name: 'lefox',
    description: 'Lefox admin commands',
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'embed',
        description: 'Postet das Team-Status-Embed (persistent).'
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: 'weekly',
        description: 'Erhalte den Wochenreport (nur für Manager sichtbar).'
      }
    ]
  }
];

const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log('Commands registered.');
  } catch (err) {
    console.error(err);
  }
})();
