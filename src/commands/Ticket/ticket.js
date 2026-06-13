import { getColor } from '../../config/bot.js';
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    StringSelectMenuBuilder
} from 'discord.js';

import { createEmbed, errorEmbed, successEmbed } from '../../utils/embeds.js';
import { getGuildConfig } from '../../services/guildConfig.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { logger } from '../../utils/logger.js';
import { handleInteractionError } from '../../utils/errorHandler.js';

import ticketConfig from './modules/ticket_dashboard.js';

export default {
    data: new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Manages the server's ticket system.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)

        .addSubcommand((subcommand) =>
            subcommand
                .setName("setup")
                .setDescription("Sets up the ticket panel.")
                .addChannelOption(option =>
                    option.setName("panel_channel")
                        .setDescription("Channel for ticket panel")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText)
                )
                .addStringOption(option =>
                    option.setName("panel_message")
                        .setDescription("Panel message")
                        .setRequired(true)
                )

                // ✅ 5 OPTIONS FOR DROPDOWN
                .addStringOption(option =>
                    option.setName("option_1")
                        .setDescription("Ticket option 1")
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName("option_2")
                        .setDescription("Ticket option 2")
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName("option_3")
                        .setDescription("Ticket option 3")
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName("option_4")
                        .setDescription("Ticket option 4")
                        .setRequired(false)
                )
                .addStringOption(option =>
                    option.setName("option_5")
                        .setDescription("Ticket option 5")
                        .setRequired(false)
                )
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("dashboard")
                .setDescription("Open dashboard")
        ),

    category: "ticket",

    async execute(interaction, config, client) {
        try {

            const deferred = await InteractionHelper.safeDefer(interaction, {
                flags: MessageFlags.Ephemeral
            });

            if (!deferred) return;

            const subcommand = interaction.options.getSubcommand();

            // ---------------- DASHBOARD ----------------
            if (subcommand === "dashboard") {
                return ticketConfig.execute(interaction, config, client);
            }

            // ---------------- SETUP ----------------
            if (subcommand === "setup") {

                const panelChannel =
                    interaction.options.getChannel("panel_channel");

                const panelMessage =
                    interaction.options.getString("panel_message") ||
                    "Click below to create a ticket.";

                // ✅ OPTIONS ARRAY (FIXED PLACE)
                const options = [
                    interaction.options.getString("option_1"),
                    interaction.options.getString("option_2"),
                    interaction.options.getString("option_3"),
                    interaction.options.getString("option_4"),
                    interaction.options.getString("option_5"),
                ].filter(Boolean);

                const setupEmbed = createEmbed({
                    title: "🎫 Ticket System",
                    description: panelMessage,
                    color: getColor('info')
                });

                let components;

                // ---------------- DROPDOWN ----------------
                if (options.length > 0) {

                    const menu = new StringSelectMenuBuilder()
                        .setCustomId("ticket_dropdown")
                        .setPlaceholder("🎫 Select a ticket type")
                        .addOptions(
                            options.map(opt => ({
                                label: opt,
                                value: opt.toLowerCase().replace(/\s+/g, "_"),
                                emoji: "🎫"
                            }))
                        );

                    components = [
                        new ActionRowBuilder().addComponents(menu)
                    ];

                } else {
                    // fallback button
                    components = [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId("create_ticket")
                                .setLabel("Create Ticket")
                                .setStyle(ButtonStyle.Primary)
                                .setEmoji("📩")
                        )
                    ];
                }

                await panelChannel.send({
                    embeds: [setupEmbed],
                    components
                });

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Ticket Panel Created",
                            `Panel sent to ${panelChannel}`
                        )
                    ]
                });
            }

        } catch (error) {
            logger.error('Ticket setup error', error);

            await handleInteractionError(interaction, error, {
                commandName: 'ticket'
            });
        }
    }
};
