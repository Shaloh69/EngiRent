'use client'

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/layout/AdminLayout';
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
} from '@heroui/react';
import { CheckCircle2, XCircle } from 'lucide-react';
import api from '@/lib/api';
import type { Verification } from '@/types';

export default function VerificationsPage() {
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [selectedVerification, setSelectedVerification] = useState<Verification | null>(null);
  const {isOpen, onOpen, onClose} = useDisclosure();

  useEffect(() => {
    fetchVerifications();
  }, []);

  const fetchVerifications = async () => {
    try {
      const response = await api.get('/verifications');
      setVerifications(response.data.data?.verifications || []);
    } catch (error) {
      console.error('Failed to fetch verifications:', error);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await api.patch(`/verifications/${id}`, { status: 'APPROVED' });
      fetchVerifications();
      onClose();
    } catch (error) {
      console.error('Failed to approve verification:', error);
    }
  };

  const handleReject = async (id: string) => {
    try {
      await api.patch(`/verifications/${id}`, { status: 'REJECTED' });
      fetchVerifications();
      onClose();
    } catch (error) {
      console.error('Failed to reject verification:', error);
    }
  };

  const getDecisionColor = (decision: string) => {
    const colors: Record<string, any> = {
      APPROVED: 'success',
      PENDING: 'warning',
      RETRY: 'secondary',
      REJECTED: 'danger',
    };
    return colors[decision] || 'default';
  };

  const openDetails = (verification: Verification) => {
    setSelectedVerification(verification);
    onOpen();
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">AI Verification Review</h1>

        <Table aria-label="Verifications table">
          <TableHeader>
            <TableColumn>VERIFICATION ID</TableColumn>
            <TableColumn>DECISION</TableColumn>
            <TableColumn>CONFIDENCE</TableColumn>
            <TableColumn>STATUS</TableColumn>
            <TableColumn>CREATED</TableColumn>
            <TableColumn>ACTIONS</TableColumn>
          </TableHeader>
          <TableBody>
            {verifications.map((verification) => (
              <TableRow key={verification.id}>
                <TableCell>{verification.id.slice(0, 8)}...</TableCell>
                <TableCell>
                  <Chip color={getDecisionColor(verification.decision)} size="sm">
                    {verification.decision}
                  </Chip>
                </TableCell>
                <TableCell>{verification.confidenceScore.toFixed(1)}%</TableCell>
                <TableCell>
                  <Chip color={verification.status === 'MANUAL_REVIEW' ? 'warning' : 'primary'} size="sm">
                    {verification.status.replace(/_/g, ' ')}
                  </Chip>
                </TableCell>
                <TableCell>{new Date(verification.createdAt).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Button size="sm" onClick={() => openDetails(verification)}>
                    Review
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Verification Details Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="2xl">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Verification Details</ModalHeader>
              <ModalBody>
                {selectedVerification && (
                  <div className="space-y-4">
                    <div>
                      <p className="font-semibold">Confidence Score:</p>
                      <p className="text-2xl">{selectedVerification.confidenceScore.toFixed(2)}%</p>
                    </div>
                    <div>
                      <p className="font-semibold">Decision:</p>
                      <Chip color={getDecisionColor(selectedVerification.decision)}>
                        {selectedVerification.decision}
                      </Chip>
                    </div>
                    <div>
                      <p className="font-semibold">Status:</p>
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
                  onClick={() => selectedVerification && handleReject(selectedVerification.id)}
                >
                  Reject
                </Button>
                <Button
                  color="success"
                  startContent={<CheckCircle2 size={16} />}
                  onClick={() => selectedVerification && handleApprove(selectedVerification.id)}
                >
                  Approve
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </AdminLayout>
  );
}
