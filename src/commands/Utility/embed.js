import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../utils/embed.js';

export default {
    data: new SlashCommandBuilder()
        .setName('embed')
        .setDescription('Create a custom embed')
        .addStringOption(option =>
            option.setName('title')
                .setDescription('Embed title')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('description')
                .setDescription('Embed description')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('color')
                .setDescription('Embed color (blue, red, green, orange, etc.)')
                .setRequired(false)
        )
        // 🔒 optional: only admins can use it
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {

        const title = interaction.options.getString('title');
        const description = interaction.options.getString('description');
        const color = interaction.options.getString('color') || 'blue';

        const embed = createEmbed({
            title,
            description,
            color
        });

        return interaction.reply({
            embeds: [embed]
        });
    }
};
