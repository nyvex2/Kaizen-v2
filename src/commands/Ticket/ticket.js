import { getColor } from '../../config/bot.js';
import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    PermissionsBitField,
    ChannelType,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} from 'discord.js';

import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
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
                .setDescription("Sets up the ticket creation panel in a specified channel.")
                .addChannelOption((option) =>
                    option
                        .setName("panel_channel")
                        .setDescription("The channel where the ticket panel will be sent.")
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("panel_message")
                        .setDescription("The main message/description for the ticket panel.")
                        .setRequired(true),
                )
                .addStringOption((option) =>
                    option
                        .setName("button_label")
                        .setDescription("Comma-separated ticket types (e.g: buy ad, buy shop, support)")
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName("category")
                        .setDescription("The category where new tickets will be created (optional).")
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addChannelOption((option) =>
                    option
                        .setName("closed_category")
                        .setDescription("The category where closed tickets will be moved (optional).")
                        .addChannelTypes(ChannelType.GuildCategory)
                        .setRequired(false),
                )
                .addRoleOption((option) =>
                    option
                        .setName("staff_role")
                        .setDescription("The role that can access tickets (optional).")
                        .setRequired(false),
                )
                .addIntegerOption((option) =>
                    option
                        .setName("max_tickets_per_user")
                        .setDescription("Maximum number of tickets a user can create (default: 3)")
                        .setMinValue(1)
                        .setMaxValue(10)
                        .setRequired(false),
                )
                .addBooleanOption((option) =>
                    option
                        .setName("dm_on_close")
                        .setDescription("Send DM to user when their ticket is closed (default: true)")
                        .setRequired(false),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("dashboard")
                .setDescription("Open the interactive ticket system dashboard"),
        ),

    category: "ticket",

    async execute(interaction, config, client) {
        try {

            const deferred = await InteractionHelper.safeDefer(interaction, {
                flags: MessageFlags.Ephemeral
            });

            if (!deferred) return;

            if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        errorEmbed(
                            "Permission Denied",
                            "You need the `Manage Channels` permission for this action."
                        ),
                    ],
                });
            }

            const subcommand = interaction.options.getSubcommand();

            if (subcommand === "dashboard") {
                return ticketConfig.execute(interaction, config, client);
            }

            if (subcommand === "setup") {

                const existingConfig = await getGuildConfig(client, interaction.guildId);

                if (existingConfig?.ticketPanelChannelId) {
                    return await InteractionHelper.safeEditReply(interaction, {
                        embeds: [
                            errorEmbed(
                                "Ticket System Already Active",
                                "This server already has a ticket system set up. Use /ticket dashboard to edit it."
                            ),
                        ],
                    });
                }

                const panelChannel = interaction.options.getChannel("panel_channel");
                const categoryChannel = interaction.options.getChannel("category");
                const closedCategoryChannel = interaction.options.getChannel("closed_category");
                const staffRole = interaction.options.getRole("staff_role");

                const panelMessage =
                    interaction.options.getString("panel_message") ||
                    "Click the button below to create a support ticket.";

                const buttonLabelInput =
                    interaction.options.getString("button_label") ||
                    "Create Ticket";

                const maxTicketsPerUser =
                    interaction.options.getInteger("max_tickets_per_user") || 3;

                const dmOnClose =
                    interaction.options.getBoolean("dm_on_close") !== false;

                // 🔥 MULTI BUTTON SYSTEM HERE
                const ticketButtonRow = new ActionRowBuilder();

                const buttonLabels = buttonLabelInput
                    .split(',')
                    .map(t => t.trim())
                    .filter(Boolean)
                    .slice(0, 5); // Discord limit safe

                buttonLabels.forEach((label) => {
                    ticketButtonRow.addComponents(
                        new ButtonBuilder()
                            .setCustomId(`create_ticket:${label}`)
                            .setLabel(label)
                            .setStyle(ButtonStyle.Primary)
                            .setEmoji("📩")
                    );
                });

                const setupEmbed = createEmbed({
                    title: "🎫 Support Tickets",
                    description: panelMessage,
                    color: getColor('info')
                });

                await panelChannel.send({
                    embeds: [setupEmbed],
                    components: [ticketButtonRow],
                });

                if (client.db && interaction.guildId) {

                    const currentConfig = existingConfig;

                    currentConfig.ticketCategoryId = categoryChannel?.id || null;
                    currentConfig.ticketClosedCategoryId = closedCategoryChannel?.id || null;
                    currentConfig.ticketStaffRoleId = staffRole?.id || null;
                    currentConfig.ticketPanelChannelId = panelChannel.id;
                    currentConfig.ticketPanelMessage = panelMessage;
                    currentConfig.ticketButtonLabel = buttonLabelInput;
                    currentConfig.maxTicketsPerUser = maxTicketsPerUser;
                    currentConfig.dmOnClose = dmOnClose;

                    const { getGuildConfigKey } = await import('../../utils/database.js');
                    const configKey = getGuildConfigKey(interaction.guildId);

                    await client.db.set(configKey, currentConfig);
                }

                await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        successEmbed(
                            "Ticket Panel Set Up",
                            `Panel sent to ${panelChannel}\n\nButtons: ${buttonLabels.join(", ")}`
                        ),
                    ],
                });

                logger.info("Ticket setup completed", {
                    guildId: interaction.guildId,
                    buttons: buttonLabels,
                });
            }

        } catch (error) {
            logger.error("Ticket command error", error);
            await handleInteractionError(interaction, error);
        }
    }
};
