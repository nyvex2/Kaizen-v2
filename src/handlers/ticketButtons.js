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

// Helper function to escape HTML special characters
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
      const permissionMessage = allowTicketCreator
        ? 'You must have **Manage Channels**, the configured **Ticket Staff Role**, or be the **ticket creator**.'
        : 'You must have **Manage Channels** or the configured **Ticket Staff Role**.';

      return {
        success: false,
        error: 'Permission Denied',
        details: `${permissionMessage}\n\nYou cannot ${actionLabel}.`
      };
    }

    return { success: true, context };
  } catch (error) {
    if (error.message === 'Timeout') {
      return {
        success: false,
        error: 'Request Timeout',
        details: 'The permission check took too long. Please try again.'
      };
    }

    return {
      success: false,
      error: 'Error',
      details: `Failed to check permissions: ${error.message}`
    };
  }
}

async function ensureTicketPermission(interaction, client, actionLabel, options = {}) {
  const { allowTicketCreator = false } = options;

  const context = await getTicketPermissionContext({ client, interaction });

  if (!context.ticketData) {
    await interaction.reply({
      embeds: [errorEmbed('Not a Ticket Channel', 'This action can only be used in a valid ticket channel.')],
      flags: MessageFlags.Ephemeral
    });
    return null;
  }

  const allowed = allowTicketCreator ? context.canCloseTicket : context.canManageTicket;

  if (!allowed) {
    const permissionMessage = allowTicketCreator
      ? 'You must have **Manage Channels**, the configured **Ticket Staff Role**, or be the **ticket creator**.'
      : 'You must have **Manage Channels** or the configured **Ticket Staff Role**.';

    await interaction.reply({
      embeds: [errorEmbed('Permission Denied', `${permissionMessage}\n\nYou cannot ${actionLabel}.`)],
      flags: MessageFlags.Ephemeral
    });
    return null;
  }

  return context;
}

/* =========================
   CREATE TICKET
========================= */

const createTicketHandler = {
  name: 'create_ticket',

  async execute(interaction, client) {
    try {
      if (!(await ensureGuildContext(interaction))) return;

      const rateLimitKey = `${interaction.user.id}:create_ticket`;
      const allowed = await checkRateLimit(rateLimitKey, 3, 60000);

      if (!allowed) {
        await interaction.reply({
          embeds: [errorEmbed('Rate Limited', 'You are creating tickets too quickly. Please wait a minute and try again.')],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const config = await getGuildConfig(client, interaction.guildId);
      const maxTicketsPerUser = config.maxTicketsPerUser || 3;

      const { getUserTicketCount } = await import('../services/ticket.js');
      const currentTicketCount = await getUserTicketCount(interaction.guildId, interaction.user.id);

      if (currentTicketCount >= maxTicketsPerUser) {
        return interaction.reply({
          embeds: [
            errorEmbed(
              '🎫 Ticket Limit Reached',
              `You have reached the maximum number of open tickets (${maxTicketsPerUser}).\n\nCurrent: ${currentTicketCount}/${maxTicketsPerUser}`
            )
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      const modal = new ModalBuilder()
        .setCustomId('create_ticket_modal')
        .setTitle('Create a Ticket');

      const reasonInput = new TextInputBuilder()
        .setCustomId('reason')
        .setLabel('Why are you creating this ticket?')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error creating ticket modal:', error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [errorEmbed('Error', 'Could not open ticket creation form.')],
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
};

/* =========================
   CREATE MODAL
========================= */

const createTicketModalHandler = {
  name: 'create_ticket_modal',

  async execute(interaction, client) {
    try {
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
        reason
      );

      if (result.success) {
        return interaction.editReply({
          embeds: [
            successEmbed('Ticket Created', `Your ticket has been created in ${result.channel}!`)
          ],
          flags: MessageFlags.Ephemeral
        });
      }

      return interaction.editReply({
        embeds: [errorEmbed('Error', result.error || 'Failed to create ticket.')],
        flags: MessageFlags.Ephemeral
      });

    } catch (error) {
      logger.error('Error creating ticket:', error);

      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed('Error', 'An error occurred while creating your ticket.')],
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
};

/* =========================
   CLOSE TICKET HANDLERS
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
        .setRequired(false)
        .setMaxLength(1000);

      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));

      await interaction.showModal(modal);
    } catch (error) {
      logger.error('Error closing ticket:', error);

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          embeds: [errorEmbed('Error', 'Could not open ticket close form.')],
          flags: MessageFlags.Ephemeral
        });
      }
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
        interaction.fields.getTextInputValue('reason')?.trim() ||
        'Closed via ticket button without a specific reason.';

      const result = await closeTicket(interaction.channel, interaction.user, reason);

      return interaction.editReply({
        embeds: [
          result.success
            ? successEmbed('Ticket Closed', 'This ticket has been closed.')
            : errorEmbed('Error', result.error || 'Failed to close ticket.')
        ],
        flags: MessageFlags.Ephemeral
      });

    } catch (error) {
      logger.error('Error submitting close ticket modal:', error);

      if (interaction.deferred) {
        await interaction.editReply({
          embeds: [errorEmbed('Error', 'An error occurred while closing the ticket.')],
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
};

/* =========================
   EXPORTS (UNCHANGED)
========================= */

export default createTicketHandler;

export {
  createTicketModalHandler,
  closeTicketModalHandler
};
