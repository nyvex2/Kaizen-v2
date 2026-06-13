import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags
} from 'discord.js';

import { createEmbed, errorEmbed, successEmbed } from '../utils/embeds.js';
import {
  createTicket,
  closeTicket,
  claimTicket,
  updateTicketPriority
} from '../services/ticket.js';

import { getGuildConfig } from '../services/guildConfig.js';
import { logTicketEvent } from '../utils/ticketLogging.js';
import { logger } from '../utils/logger.js';
import { InteractionHelper } from '../utils/interactionHelper.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { getTicketPermissionContext } from '../utils/ticketPermissions.js';

// Helper function
function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function ensureGuildContext(interaction) {
  if (interaction.inGuild()) return true;

  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply({
      embeds: [errorEmbed('Guild Only', 'This action can only be used in a server.')],
      flags: MessageFlags.Ephemeral
    });
  }

  return false;
}

async function checkTicketPermissionWithTimeout(interaction, client, actionLabel, options = {}, timeoutMs = 2500) {
  const { allowTicketCreator = false } = options;

  try {
    const contextPromise = getTicketPermissionContext({ client, interaction });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), timeoutMs)
    );

    const context = await Promise.race([contextPromise, timeoutPromise]);

    if (!context.ticketData) {
      return {
        success: false,
        error: 'Not a Ticket Channel',
        details: 'This action can only be used in a valid ticket channel.'
      };
    }

    const allowed = allowTicketCreator ? context.canCloseTicket : context.canManageTicket;

    if (!allowed) {
      return {
        success: false,
        error: 'Permission Denied',
        details: `You cannot ${actionLabel}.`
      };
    }

    return { success: true, context };
  } catch (error) {
    return {
      success: false,
      error: 'Error',
      details: error.message
    };
  }
}

/* =========================
   CREATE TICKET HANDLER (FIXED)
========================= */

const createTicketHandler = {
  name: 'create_ticket',

  async execute(interaction, client) {
    try {

      // ✅ MUST SUPPORT MULTI BUTTONS
      if (!interaction.customId.startsWith('create_ticket')) return;

      const ticketType = interaction.customId.split(':')[1] || 'general';

      if (!(await ensureGuildContext(interaction))) return;

      const rateLimitKey = `${interaction.user.id}:create_ticket`;
      const allowed = await checkRateLimit(rateLimitKey, 3, 60000);

      if (!allowed) {
        return interaction.reply({
          embeds: [errorEmbed('Rate Limited', 'You are creating tickets too quickly.')],
          flags: MessageFlags.Ephemeral
        });
      }

      const config = await getGuildConfig(client, interaction.guildId);
      const maxTicketsPerUser = config.maxTicketsPerUser || 3;

      const { getUserTicketCount } = await import('../services/ticket.js');
      const currentTicketCount = await getUserTicketCount(interaction.guildId, interaction.user.id);

      if (currentTicketCount >= maxTicketsPerUser) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              'Ticket Limit Reached',
              `Max: ${maxTicketsPerUser}`
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      const modal = new ModalBuilder()
        .setCustomId(`create_ticket_modal:${ticketType}`)
        .setTitle(`Create Ticket - ${ticketType}`);

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Why are you creating this ticket?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput)
      );

      await interaction.showModal(modal);

    } catch (error) {
      logger.error('Create ticket error:', error);
    }
  }
};

/* =========================
   CREATE MODAL (FIXED)
========================= */

const createTicketModalHandler = {
  name: 'create_ticket_modal',

  async execute(interaction, client) {
    try {

      if (!interaction.customId.startsWith('create_ticket_modal')) return;

      const ticketType = interaction.customId.split(':')[1] || 'general';

      if (!(await ensureGuildContext(interaction))) return;

      const deferSuccess = await InteractionHelper.safeDefer(interaction, {
        flags: MessageFlags.Ephemeral
      });

      if (!deferSuccess) return;

      const reason = interaction.fields.getTextInputValue('reason');
      const config = await getGuildConfig(client, interaction.guildId);

      const result = await createTicket(
        interaction.guild,
        interaction.member,
        config.ticketCategoryId || null,
        `${ticketType}: ${reason}`
      );

      return interaction.editReply({
        embeds: [
          result.success
            ? successEmbed('Ticket Created', `Type: ${ticketType}`)
            : errorEmbed('Error', result.error || 'Failed to create ticket.')
        ],
        flags: MessageFlags.Ephemeral
      });

    } catch (error) {
      logger.error('Modal error:', error);
    }
  }
};

/* =========================
   CLOSE TICKET
========================= */

const closeTicketHandler = {
  name: 'ticket_close',

  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const permissionCheck = await checkTicketPermissionWithTimeout(
        interaction,
        client,
        'close this ticket',
        { allowTicketCreator: true },
        2000
      );

      if (!permissionCheck.success) {
        return interaction.reply({
          embeds: [errorEmbed(permissionCheck.error, permissionCheck.details)],
          flags: MessageFlags.Ephemeral
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('ticket_close_modal')
        .setTitle('Close Ticket');

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Reason (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(reasonInput)
      );

      await interaction.showModal(modal);

    } catch (error) {
      logger.error(error);
    }
  }
};

/* =========================
   CLOSE MODAL
========================= */

const closeTicketModalHandler = {
  name: 'ticket_close_modal',

  async execute(interaction, client) {
    try {

      if (!(await ensureGuildContext(interaction))) return;

      const permissionCheck = await checkTicketPermissionWithTimeout(
        interaction,
        client,
        'close this ticket',
        { allowTicketCreator: true },
        2000
      );

      if (!permissionCheck.success) {
        return interaction.reply({
          embeds: [errorEmbed(permissionCheck.error, permissionCheck.details)],
          flags: MessageFlags.Ephemeral
        });
      }

      await InteractionHelper.safeDefer(interaction, {
        flags: MessageFlags.Ephemeral
      });

      const reason =
        interaction.fields.getTextInputValue('reason') || 'No reason';

      const result = await closeTicket(interaction.channel, interaction.user, reason);

      return interaction.editReply({
        embeds: [
          result.success
            ? successEmbed('Ticket Closed', 'Closed successfully')
            : errorEmbed('Error', result.error)
        ],
        flags: MessageFlags.Ephemeral
      });

    } catch (error) {
      logger.error(error);
    }
  }
};

/* =========================
   EXPORTS
========================= */

export default createTicketHandler;

export {
  createTicketModalHandler,
  closeTicketModalHandler
};
