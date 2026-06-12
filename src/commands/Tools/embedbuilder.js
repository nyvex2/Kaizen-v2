import {
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    ComponentType,
    ChannelType,
    EmbedBuilder,
    LabelBuilder,
    RadioGroupBuilder,
} from 'discord.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { successEmbed, errorEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getColor } from '../../config/bot.js';

// ─── QUICK COLOR MAP ───────────────────────────────────────────────
const COLOR_MAP = {
    blue: '#3498db',
    red: '#e74c3c',
    green: '#2ecc71',
    yellow: '#f1c40f',
    orange: '#f39c12',
    purple: '#9b59b6',
};

// ─── CONSTANTS ─────────────────────────────────────────────────────
const MAX_FIELDS = 25;
const IDLE_TIMEOUT = 900_000;

// ─── FULL FILE (YOUR ORIGINAL CODE BELOW) ──────────────────────────

export default {
    data: new SlashCommandBuilder()
        .setName('embedbuilder')
        .setDescription('Build or quickly send embeds with live preview')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)

        // ✅ QUICK MODE OPTIONS ADDED
        .addStringOption(opt =>
            opt
                .setName('message')
                .setDescription('Quick embed message (skip builder UI)')
                .setRequired(false)
        )
        .addStringOption(opt =>
            opt
                .setName('color')
                .setDescription('blue, red, green, orange, yellow...')
                .setRequired(false)
        ),

    async execute(interaction) {
        try {

            // ─────────────────────────────────────────────
            // ⚡ QUICK MODE (NEW)
            // ─────────────────────────────────────────────
            const message = interaction.options.getString('message');
            const colorInput = interaction.options.getString('color')?.toLowerCase();

            if (message) {
                const color = COLOR_MAP[colorInput] || getColor('primary');

                const quickEmbed = new EmbedBuilder()
                    .setDescription(message)
                    .setColor(color);

                return interaction.reply({
                    embeds: [quickEmbed],
                    ephemeral: false,
                });
            }

            // ─────────────────────────────────────────────
            // 🛠 FULL BUILDER MODE (YOUR ORIGINAL SYSTEM)
            // ─────────────────────────────────────────────

            const deferSuccess = await InteractionHelper.safeDefer(interaction, {
                flags: MessageFlags.Ephemeral,
            });
            if (!deferSuccess) return;

            const guild = interaction.guild;

            const state = {
                title: null,
                description: null,
                color: getColor('primary'),
                author: null,
                footer: null,
                thumbnail: null,
                image: null,
                timestamp: false,
                fields: [],
            };

            await refreshDashboard(interaction, state);

            const collector = interaction.channel.createMessageComponentCollector({
                componentType: ComponentType.StringSelect,
                filter: i =>
                    i.user.id === interaction.user.id && i.customId === 'eb_menu',
                time: IDLE_TIMEOUT,
            });

            collector.on('collect', async ci => {
                try {
                    switch (ci.values[0]) {

                        case 'edit_content':
                            await handleEditContent(ci, interaction, state);
                            break;

                        case 'set_color':
                            await handleSetColor(ci, interaction, state);
                            break;

                        case 'set_author':
                            await handleSetAuthor(ci, interaction, state);
                            break;

                        case 'set_footer':
                            await handleSetFooter(ci, interaction, state);
                            break;

                        case 'set_images':
                            await handleSetImages(ci, interaction, state);
                            break;

                        case 'add_field':
                            await handleAddField(ci, interaction, state);
                            break;

                        case 'edit_field':
                            await handleEditField(ci, interaction, state);
                            break;

                        case 'remove_field':
                            await handleRemoveField(ci, interaction, state);
                            break;

                        case 'reorder_fields':
                            await handleReorderFields(ci, interaction, state);
                            break;

                        case 'toggle_timestamp':
                            state.timestamp = !state.timestamp;
                            await ci.deferUpdate();
                            await refreshDashboard(interaction, state);
                            break;

                        case 'post_embed':
                            await handlePostEmbed(ci, interaction, state, guild);
                            break;

                        case 'json_export':
                            await handleJsonExport(ci, interaction, state);
                            break;

                        case 'reset_all':
                            state.title = null;
                            state.description = null;
                            state.color = getColor('primary');
                            state.author = null;
                            state.footer = null;
                            state.thumbnail = null;
                            state.image = null;
                            state.timestamp = false;
                            state.fields = [];
                            await ci.deferUpdate();
                            await refreshDashboard(interaction, state);
                            break;

                        default:
                            await ci.deferUpdate();
                    }
                } catch (error) {
                    logger.error('Embedbuilder error:', error);
                }
            });

            collector.on('end', async (_, reason) => {
                if (reason === 'time') {
                    await InteractionHelper.safeEditReply(interaction, { components: [] })
                        .catch(() => {});
                }
            });

        } catch (error) {
            logger.error('Unexpected embedbuilder error:', error);
            throw new TitanBotError(
                `embedbuilder failed: ${error.message}`,
                ErrorTypes.UNKNOWN,
                'Failed to open embed builder.'
            );
        }
    },
};
