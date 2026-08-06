"use client";

import { Badge, Card, List, SimpleGrid, Text } from "@mantine/core";
import { motion } from "framer-motion";
import { title, subtitle } from "@/components/primitives";

const tiers = [
  {
    name: "Student Basic",
    price: "PHP 0",
    desc: "Core access for student owners and renters.",
    bullets: [
      "Browse and list items",
      "Rental booking and timeline tracking",
      "Standard notifications",
    ],
  },
  {
    name: "Kiosk Transaction",
    price: "Per Rental",
    desc: "Operational fees tied to locker and verification usage.",
    bullets: [
      "QR + face kiosk access",
      "Deposit and return evidence capture",
      "AI verification processing",
    ],
    featured: true,
  },
  {
    name: "Admin Operations",
    price: "Institution Plan",
    desc: "Control layer for school administrators.",
    bullets: [
      "Monitoring and audit views",
      "Dispute and refund tooling",
      "Policy threshold management",
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className={title({ fullWidth: true })}>Pricing Model</h1>
        <p className={subtitle()}>
          EngiRent is designed for campus adoption. Core user access is free for
          students, while transaction and operations costs are tied to kiosk
          usage and institutional deployment.
        </p>
      </header>

      <SimpleGrid cols={{ base: 1, lg: 3 }}>
        {tiers.map((tier, i) => (
          <motion.div
            key={tier.name}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.08 }}
          >
            <Card
              withBorder
              radius="lg"
              padding="lg"
              h="100%"
              style={
                tier.featured
                  ? { borderColor: "var(--mantine-color-violet-6)", background: "var(--mantine-color-violet-0)" }
                  : undefined
              }
            >
              {tier.featured && (
                <Badge color="violet" w="fit-content" mb="sm">
                  Recommended
                </Badge>
              )}
              <Text fw={700} size="xl">
                {tier.name}
              </Text>
              <Text fw={600} c="violet" size="sm" mt={4}>
                {tier.price}
              </Text>
              <Text size="sm" c="dimmed" mt="xs" mb="sm">
                {tier.desc}
              </Text>
              <List size="sm" c="dimmed">
                {tier.bullets.map((bullet) => (
                  <List.Item key={bullet}>{bullet}</List.Item>
                ))}
              </List>
            </Card>
          </motion.div>
        ))}
      </SimpleGrid>
    </div>
  );
}
