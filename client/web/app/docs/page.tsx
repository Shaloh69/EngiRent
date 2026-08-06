"use client";

import { Card, List, SimpleGrid, Text } from "@mantine/core";
import { motion } from "framer-motion";
import { title, subtitle } from "@/components/primitives";

const sections = [
  {
    id: "owner-flow",
    title: "Owner Flow",
    steps: [
      "Create listing with photos, pricing, and schedule.",
      "Receive deposit request after renter payment is held.",
      "Complete QR + face auth at kiosk and deposit item.",
      "Get payout when deposit verification passes.",
      "Retrieve item after return verification and close rental.",
    ],
  },
  {
    id: "renter-flow",
    title: "Renter Flow",
    steps: [
      "Browse and reserve item from mobile app.",
      "Initiate GCash payment and wait for owner deposit.",
      "Receive pickup notification with QR token.",
      "Use QR + face auth at kiosk to claim item.",
      "Return item via kiosk before due time.",
    ],
  },
  {
    id: "verification",
    title: "Verification Pipeline",
    steps: [
      "Kiosk captures images at deposit and return.",
      "Node backend submits evidence to Python AI service.",
      "AI returns confidence scores and decision hints.",
      "Backend applies policy thresholds and transitions rental state.",
      "Admin can manually review flagged results.",
    ],
  },
  {
    id: "security",
    title: "Security Controls",
    steps: [
      "Short-lived rental-specific QR tokens.",
      "Face verification linked to enrolled user profile.",
      "Audit logs for admin actions and kiosk events.",
      "Role-based control for admin-only operations.",
      "Policy-driven refund, dispute, and penalty handling.",
    ],
  },
];

export default function DocsPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className={title({ fullWidth: true })}>System Documentation</h1>
        <p className={subtitle()}>
          High-level implementation blueprint for the EngiRent lifecycle across
          mobile app, backend orchestration, kiosk workflows, and AI
          verification services.
        </p>
      </header>

      <SimpleGrid cols={{ base: 1, lg: 2 }}>
        {sections.map((section, i) => (
          <motion.div
            key={section.id}
            id={section.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: i * 0.06 }}
          >
            <Card withBorder radius="lg" padding="lg" h="100%">
              <Text fw={700} size="lg" mb="sm">
                {section.title}
              </Text>
              <List type="ordered" size="sm" c="dimmed" spacing="xs">
                {section.steps.map((step) => (
                  <List.Item key={step}>{step}</List.Item>
                ))}
              </List>
            </Card>
          </motion.div>
        ))}
      </SimpleGrid>
    </div>
  );
}
