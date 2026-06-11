import { Events } from "discord.js";
import { logger, startupLog } from "../utils/logger.js";
import config from "../config/application.js";
import { reconcileReactionRoleMessages } from "../services/reactionRoleService.js";
import { rotatingStatuses } from "../config/rotatingStatuses.js";

export default {
  name: Events.ClientReady,
  once: true,

  async execute(client) {
    try {
      // =========================
      // PRESENCE (base config status still used)
      // =========================
      client.user.setPresence(config.bot.presence);

      // =========================
      // STARTUP LOGS (UNCHANGED)
      // =========================
      startupLog(`Ready! Logged in as ${client.user.tag}`);
      startupLog(`Serving ${client.guilds.cache.size} guild(s)`);
      startupLog(`Loaded ${client.commands?.size || 0} commands`);

      // =========================
      // REACTION ROLE RECONCILIATION (UNCHANGED)
      // =========================
      const reconciliationSummary = await reconcileReactionRoleMessages(client);
      startupLog(
        `Reaction role reconciliation: scanned ${reconciliationSummary.scannedMessages}, removed ${reconciliationSummary.removedMessages}, errors ${reconciliationSummary.errors}`
      );

      // =========================
      // ROTATING STATUS SYSTEM (FIXED)
      // =========================
      let index = 0;

      const updateStatus = () => {
        try {
          const statusText = rotatingStatuses[index];

          // Keep your base presence status (online/idle/dnd/invisible)
          const baseStatus = config.bot?.presence?.status || "online";

          client.user.setPresence({
            activities: [
              {
                name: statusText,
                type: 0, // Playing
              },
            ],
            status: baseStatus,
          });

          index = (index + 1) % rotatingStatuses.length;
        } catch (err) {
          logger.error("Rotating status error:", err);
        }
      };

      // run immediately so bot doesn't wait 10s
      updateStatus();

      // rotate every 10 seconds
      const interval = setInterval(updateStatus, 10_000);

      // optional safety: clear interval if bot shuts down
      client.once("disconnect", () => clearInterval(interval));

      startupLog(
        `Rotating status system loaded (${rotatingStatuses.length} statuses)`
      );
    } catch (error) {
      logger.error("Error in ready event:", error);
    }
  },
};
