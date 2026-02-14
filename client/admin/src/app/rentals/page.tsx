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
  Select,
  SelectItem,
} from '@heroui/react';
import api from '@/lib/api';
import type { Rental } from '@/types';
import { format } from 'date-fns';

const statuses = [
  'PENDING',
  'AWAITING_DEPOSIT',
  'DEPOSITED',
  'ACTIVE',
  'AWAITING_RETURN',
  'VERIFICATION',
  'COMPLETED',
  'CANCELLED',
  'DISPUTED',
];

export default function RentalsPage() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    fetchRentals();
  }, []);

  const fetchRentals = async () => {
    try {
      const response = await api.get('/rentals');
      setRentals(response.data.data?.rentals || []);
    } catch (error) {
      console.error('Failed to fetch rentals:', error);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, any> = {
      ACTIVE: 'success',
      PENDING: 'warning',
      COMPLETED: 'primary',
      CANCELLED: 'danger',
      VERIFICATION: 'secondary',
    };
    return colors[status] || 'default';
  };

  const filteredRentals = rentals.filter(rental =>
    statusFilter === '' || rental.status === statusFilter
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">Rental Management</h1>
          <Select
            placeholder="Filter by status"
            className="max-w-xs"
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <SelectItem key="" value="">All Statuses</SelectItem>
            {statuses.map((status) => (
              <SelectItem key={status} value={status}>
                {status.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </Select>
        </div>

        <Table aria-label="Rentals table">
          <TableHeader>
            <TableColumn>RENTAL ID</TableColumn>
            <TableColumn>ITEM</TableColumn>
            <TableColumn>RENTER</TableColumn>
            <TableColumn>START DATE</TableColumn>
            <TableColumn>END DATE</TableColumn>
            <TableColumn>STATUS</TableColumn>
            <TableColumn>PRICE</TableColumn>
          </TableHeader>
          <TableBody>
            {filteredRentals.map((rental) => (
              <TableRow key={rental.id}>
                <TableCell>{rental.id.slice(0, 8)}...</TableCell>
                <TableCell>{rental.item.title}</TableCell>
                <TableCell>{rental.renter.firstName} {rental.renter.lastName}</TableCell>
                <TableCell>{format(new Date(rental.startDate), 'MMM dd, yyyy')}</TableCell>
                <TableCell>{format(new Date(rental.endDate), 'MMM dd, yyyy')}</TableCell>
                <TableCell>
                  <Chip color={getStatusColor(rental.status)} size="sm">
                    {rental.status.replace(/_/g, ' ')}
                  </Chip>
                </TableCell>
                <TableCell>₱{rental.totalPrice}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </AdminLayout>
  );
}
