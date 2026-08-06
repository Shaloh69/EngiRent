"use client";

import { Badge, Button, Card, SimpleGrid, ThemeIcon, Group, Text, Stack } from "@mantine/core";
import { motion } from "framer-motion";
import NextLink from "next/link";
import { title, subtitle } from "@/components/primitives";

const features = [
  {
    icon: "MB",
    name: "Mobile Booking",
    text: "Students browse listings, schedule rentals, and track each stage in real-time.",
  },
  {
    icon: "QR",
    name: "Kiosk QR + Face",
    text: "Owner and renter actions are gated by short-lived QR tokens and face verification.",
  },
  {
    icon: "AI",
    name: "AI Verification",
    text: "Deposit and return photos are evaluated by the ML service for identity and condition checks.",
  },
  {
    icon: "SC",
    name: "Escrow-Controlled Payout",
    text: "Rental payment release/refund follows verification and policy rules to reduce disputes.",
  },
];

const focusItems = [
  "Payment stays in escrow until owner deposit is verified.",
  "Pickup and return require QR + face validation for both parties.",
  "Admin receives monitoring feeds for disputes, penalties, and fallback handling.",
];

export default function Home() {
  return (
    <section className="space-y-8 pb-6 sm:space-y-12">
      <div className="grid gap-6 lg:grid-cols-2 lg:gap-10">
        <motion.div
          className="space-y-5"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
        >
          <Badge color="violet" variant="light" size="lg">
            UCLM Engineering Thesis Platform
          </Badge>
          <h1 className={title({ size: "lg", fullWidth: true })}>
            Smart, Secure Student
            <br />
            <span className={title({ color: "primary", size: "lg" })}>
              Rental Workflows
            </span>
          </h1>
          <p className={subtitle()}>
            EngiRent Hub connects mobile users, admin operations, and kiosk
            automation into one controlled rental lifecycle: listing, escrow
            payment, deposit verification, pickup, return checks, and
            completion.
          </p>
          <Group>
            <Button component={NextLink} href="/docs" color="violet" size="md">
              Explore Architecture
            </Button>
            <Button component={NextLink} href="/about" variant="default" size="md">
              About the Team
            </Button>
          </Group>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
        >
          <Card withBorder radius="lg" padding="xl" h="100%">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 2 }}>
              Current Focus
            </Text>
            <Text size="xl" fw={800} mt={4} mb="md">
              End-to-End Kiosk Transaction Reliability
            </Text>
            <Stack gap="sm">
              {focusItems.map((item) => (
                <div key={item} className="focus-item">
                  {item}
                </div>
              ))}
            </Stack>
          </Card>
        </motion.div>
      </div>

      <SimpleGrid cols={{ base: 1, md: 2, xl: 4 }}>
        {features.map((feature, i) => (
          <motion.div
            key={feature.name}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 + i * 0.06 }}
          >
            <Card withBorder radius="md" padding="lg" h="100%">
              <ThemeIcon size={40} radius="md" variant="light" color="violet" mb="sm">
                <Text size="xs" fw={800}>
                  {feature.icon}
                </Text>
              </ThemeIcon>
              <Text fw={700} mb={4}>
                {feature.name}
              </Text>
              <Text size="sm" c="dimmed">
                {feature.text}
              </Text>
            </Card>
          </motion.div>
        ))}
      </SimpleGrid>
    </section>
  );
}
