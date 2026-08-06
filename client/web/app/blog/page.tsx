"use client";

import { Card, SimpleGrid, Text } from "@mantine/core";
import { motion } from "framer-motion";
import { title, subtitle } from "@/components/primitives";

const posts = [
  {
    title: "Designing a Safe Student Rental Lifecycle",
    excerpt:
      "Why escrow states, identity checks, and kiosk evidence capture need to work as one system.",
    date: "2026-02-10",
  },
  {
    title: "AI Verification for Deposit and Return Events",
    excerpt:
      "How confidence-driven decisions reduce manual review while keeping admins in control.",
    date: "2026-01-28",
  },
  {
    title: "From Informal Borrowing to Accountable Automation",
    excerpt:
      "Mapping thesis survey pain points into concrete product workflows.",
    date: "2026-01-16",
  },
];

export default function BlogPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className={title({ fullWidth: true })}>Project Journal</h1>
        <p className={subtitle()}>
          Notes from the implementation journey across hardware integration,
          software orchestration, and student-user validation.
        </p>
      </header>

      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
        {posts.map((post, i) => (
          <motion.div
            key={post.title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
          >
            <Card withBorder radius="lg" padding="lg" h="100%">
              <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 2 }}>
                {post.date}
              </Text>
              <Text fw={700} size="lg" mt="xs" mb={4}>
                {post.title}
              </Text>
              <Text size="sm" c="dimmed">
                {post.excerpt}
              </Text>
            </Card>
          </motion.div>
        ))}
      </SimpleGrid>
    </div>
  );
}
