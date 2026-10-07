/** Which YouTube channel a video is for. Dot colours come from each channel's art. */
const DOT: Record<string, string> = {
  blast: '#FFD23F', // Blast of Facts yellow
  wonder: '#6EC6FF', // I Wonder Why sky blue
};

export function ChannelBadge({ channel, title }: { channel: string; title: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm text-muted" data-testid="channel-badge">
      <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: DOT[channel] ?? 'currentColor' }} />
      {title}
    </span>
  );
}
