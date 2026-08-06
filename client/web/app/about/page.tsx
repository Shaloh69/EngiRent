"use client";

import { Card, Text, SimpleGrid, Stack } from "@mantine/core";
import { motion } from "framer-motion";
import { title, subtitle } from "@/components/primitives";

export default function AboutPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <h1 className={title({ fullWidth: true })}>About EngiRent Hub</h1>
        <p className={subtitle()}>
          EngiRent Hub is an IoT-powered rental platform developed for UCLM
          Engineering students to access academic tools affordably while
          reducing risks from informal peer-to-peer borrowing.
        </p>
      </header>

      <SimpleGrid cols={{ base: 1, lg: 3 }}>
        <motion.div
          style={{ gridColumn: "span 2" }}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <Card withBorder radius="lg" padding="lg" h="100%">
            <Text fw={700} size="lg" mb="sm">
              Project Intent
            </Text>
            <Stack gap="sm">
              <Text size="sm" c="dimmed">
                Build a complete end-to-end flow where trust is enforced by
                system controls: identity verification, kiosk automation,
                payment hold/release logic, and machine-assisted item
                validation on deposit and return.
              </Text>
              <Text size="sm" c="dimmed">
                The architecture combines Flutter mobile clients, a Node.js
                backend as source of truth, a Python vision service, and admin
                monitoring tools for disputes, policy enforcement, and
                operations.
              </Text>
            </Stack>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08 }}
        >
          <Card id="contact" withBorder radius="lg" padding="lg" bg="var(--mantine-color-violet-0)" h="100%">
            <Text size="xs" fw={700} tt="uppercase" c="dimmed" style={{ letterSpacing: 2 }}>
              Contact
            </Text>
            <Text size="sm" fw={700} mt="sm">
              Engineering Thesis Team
            </Text>
            <Text size="sm" c="dimmed">
              University of Cebu Lapu-Lapu and Mandaue
            </Text>
            <Text size="sm" c="dimmed">
              support@engirenthub.com
            </Text>
          </Card>
        </motion.div>
      </SimpleGrid>
    </div>
  );
}
