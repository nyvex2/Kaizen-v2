import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';

const colors = {
    blue: '#3498db',
    red: '#e74c3c',
    green: '#2ecc71',
    orange: '#f39c12',
    yellow: '#f1c40f',
    purple: '#9b59b6',
    pink: '#ff69b4',
    black: '#2c3e50',
    white: '#ffffff',
    gold: '#ffd700',
    aqua: '#1abc9c'
};

// ----------------------
// EMBED CREATOR
// ----------------------
export function createEmbed({
    title = '',
    description = '',
    color = 'blue',
    footer = null,
    thumbnail = null,
    image = null
}) {
    const embed = new EmbedBuilder()
        .setColor(colors[color.toLowerCase()] || colors.blue)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();

    if (footer) embed.setFooter({ text: footer });
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (image) embed.setImage(image);

    return embed;
}

// ----------------------
// ADMIN GUARD (PUTS EVERYTHING HERE)
// ----------------------
export async function adminOnly(interaction, callback) {
    const isAdmin = interaction.member.permissions.has(
        PermissionFlagsBits.Administrator
    );

    if (!isAdmin) {
        return interaction.reply({
            embeds: [
                createEmbed({
                    title: '❌ No Permission',
                    description: 'You need **Administrator** to use this command.',
                    color: 'red'
                })
            ],
            ephemeral: true
        });
    }

    // run command if admin
    return callback();
}
