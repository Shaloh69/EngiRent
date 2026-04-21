"use client";

import { useEffect, useState } from "react";
import AdminLayout from "@/components/layout/AdminLayout";
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Spinner,
} from "@heroui/react";
import { CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import api from "@/lib/api";
import type { Verification } from "@/types";

export default function VerificationsPage() {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [selectedVerification, setSelectedVerification] =
    useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { isOpen, onOpen, onClose } = useDisclosure();

  useEffect(() => {
    void fetchVerifications();
  }, []);

  const fetchVerifications = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/admin/verifications");
      setVerifications(response.data.data?.verifications || []);
    } catch (apiError: any) {
      setError(
        apiError?.response?.data?.error || "Failed to fetch verifications.",
      );
      setVerifications([]);
    } finally {
      setLoading(false);
    }
  };

  const handleUpdate = async (id: string, status: "APPROVED" | "REJECTED") => {
    try {
      await api.patch(`/admin/verifications/${id}`, { status });
      await fetchVerifications();
      onClose();
    } catch (apiError: any) {
      setError(
        apiError?.response?.data?.error ||
          `Failed to ${status.toLowerCase()} verification.`,
      );
    }
  };

  const getDecisionColor = (decision: string) => {
    const colors: Record<string, any> = {
      APPROVED: "success",
      PENDING: "warning",
      RETRY: "secondary",
      REJECTED: "danger",
    };
    return colors[decision] || "default";
  };

  const openDetails = (verification: Verification) => {
    setSelectedVerification(verification);
    onOpen();
  };

  return (
    <AdminLayout>
      <div className="space-y-5 sm:space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] app-muted">
              AI Review
            </p>
            <h1 className="text-2xl font-extrabold text-[var(--color-ink)] sm:text-3xl">
              Verification Queue
            </h1>
          </div>
          <Button
            variant="flat"
            startContent={<RefreshCw size={16} />}
            onPress={fetchVerifications}
          >
            Refresh
          </Button>
        </div>

        {error && (
          <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
            {error}
          </div>
        )}

        <div className="app-surface overflow-x-auto rounded-2xl border border-[var(--color-border)] p-3 sm:p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner label="Loading verifications..." />
            </div>
          ) : (
            <Table aria-label="Verifications table" removeWrapper>
              <TableHeader>
                <TableColumn>VERIFICATION ID</TableColumn>
                <TableColumn>DECISION</TableColumn>
                <TableColumn>CONFIDENCE</TableColumn>
                <TableColumn>STATUS</TableColumn>
                <TableColumn>CREATED</TableColumn>
                <TableColumn>ACTIONS</TableColumn>
              </TableHeader>
              <TableBody emptyContent="No verification records found.">
                {verifications.map((verification) => (
                  <TableRow key={verification.id}>
                    <TableCell className="font-mono text-xs">
                      {verification.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>
                      <Chip
                        color={getDecisionColor(verification.decision)}
                        size="sm"
                      >
                        {verification.decision}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      {verification.confidenceScore.toFixed(1)}%
                    </TableCell>
                    <TableCell>
                      <Chip
                        color={
                          verification.status === "MANUAL_REVIEW"
                            ? "warning"
                            : "primary"
                        }
                        size="sm"
                      >
                        {verification.status.replace(/_/g, " ")}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      {new Date(verification.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="flat"
                        onPress={() => openDetails(verification)}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Modal isOpen={isOpen} onClose={onClose} size="2xl">
        <ModalContent>
          <>
            <ModalHeader>Verification Details</ModalHeader>
            <ModalBody>
              {selectedVerification && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[var(--color-border)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] app-muted">
                      Confidence
                    </p>
                    <p className="text-3xl font-extrabold text-[var(--color-ink)]">
                      {selectedVerification.confidenceScore.toFixed(2)}%
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <Chip
                      color={getDecisionColor(selectedVerification.decision)}
                    >
                      {selectedVerification.decision}
                    </Chip>
                    <Chip>{selectedVerification.status}</Chip>
                  </div>
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button
                color="danger"
                variant="flat"
                startContent={<XCircle size={16} />}
                onPress={() =>
                  selectedVerification &&
                  handleUpdate(selectedVerification.id, "REJECTED")
                }
              >
                Reject
              </Button>
              <Button
                color="success"
                startContent={<CheckCircle2 size={16} />}
                onPress={() =>
                  selectedVerification &&
                  handleUpdate(selectedVerification.id, "APPROVED")
                }
              >
                Approve
              </Button>
            </ModalFooter>
          </>
        </ModalContent>
      </Modal>
    </AdminLayout>
  );
}
