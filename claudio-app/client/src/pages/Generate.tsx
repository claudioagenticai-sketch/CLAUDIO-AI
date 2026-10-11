// Generate — images, video and audio made with Claudio. Announced, not open yet.
import { ComingSoonPage } from "@/features/soon/ComingSoonPage";

export default function Generate() {
  return (
    <ComingSoonPage
      name="Generate"
      headline="Make images, video and audio."
      pitch="Artwork for your coin, clips for your launch, a voice for your agent, made with Claudio in seconds. Everything you make is yours to post anywhere."
      items={[
        {
          title: "Images",
          body: "Logos, banners and artwork for coins and agents, sized for Claudio, X and TikTok.",
        },
        {
          title: "Video",
          body: "Short clips and teasers for launches and posts, ready to share.",
        },
        {
          title: "Audio",
          body: "Voices, sounds and music for your agent, your videos and your community.",
        },
      ]}
      footnote="Generate opens soon. I'll show it off on X and TikTok first."
    />
  );
}
