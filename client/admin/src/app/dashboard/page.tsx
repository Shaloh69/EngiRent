'use client'

import { useEffect, useState } from 'react';
import AdminLayout from '@/components/layout/AdminLayout';
import StatsCard from '@/components/charts/StatsCard';
import { Users, Package, Receipt, CheckCircle2, DollarSign } from 'lucide-react';
import { Card, CardBody, CardHeader, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Chip } from '@heroui/react';
import api from '@/lib/api';
import type { DashboardStats, Rental } from '@/types';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    totalItems: 0,
    activeRentals: 0,
    pendingVerifications: 0,
    totalRevenue: 0,
  });
  const [recentRentals, setRecentRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      // Fetch stats from various endpoints
      const [usersRes, itemsRes, rentalsRes] = await Promise.all([
        api.get('/users'),
        api.get('/items'),
        api.get('/rentals'),
      ]);

      const users = usersRes.data.data?.users || [];
      const items = itemsRes.data.data?.items || [];
      const rentals = rentalsRes.data.data?.rentals || [];

      setStats({
        totalUsers: users.length,
        totalItems: items.length,
        activeRentals: rentals.filter((r: Rental) => r.status === 'ACTIVE').length,
        pendingVerifications: rentals.filter((r: Rental) => r.status === 'VERIFICATION').length,
        totalRevenue: rentals.reduce((sum: number, r: Rental) => sum + r.totalPrice, 0),
      });

      setRecentRentals(rentals.slice(0, 5));
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, "success" | "warning" | "danger" | "primary"> = {
      ACTIVE: 'success',
      PENDING: 'warning',
      COMPLETED: 'primary',
      CANCELLED: 'danger',
    };
    return colors[status] || 'default';
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Dashboard</h1>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
          <StatsCard
            title="Total Users"
            value={stats.totalUsers}
            icon={Users}
            color="bg-blue-500"
            trend={{ value: 12, isPositive: true }}
          />
          <StatsCard
            title="Total Items"
            value={stats.totalItems}
            icon={Package}
            color="bg-green-500"
            trend={{ value: 8, isPositive: true }}
          />
          <StatsCard
            title="Active Rentals"
            value={stats.activeRentals}
            icon={Receipt}
            color="bg-purple-500"
          />
          <StatsCard
            title="Pending Verifications"
            value={stats.pendingVerifications}
            icon={CheckCircle2}
            color="bg-orange-500"
          />
          <StatsCard
            title="Total Revenue"
            value={`₱${stats.totalRevenue.toLocaleString()}`}
            icon={DollarSign}
            color="bg-pink-500"
            trend={{ value: 23, isPositive: true }}
          />
        </div>

        {/* Recent Rentals */}
        <Card>
          <CardHeader>
            <h2 className="text-xl font-semibold">Recent Rentals</h2>
          </CardHeader>
          <CardBody>
            <Table aria-label="Recent rentals table">
              <TableHeader>
                <TableColumn>RENTAL ID</TableColumn>
                <TableColumn>ITEM</TableColumn>
                <TableColumn>RENTER</TableColumn>
                <TableColumn>STATUS</TableColumn>
                <TableColumn>PRICE</TableColumn>
              </TableHeader>
              <TableBody>
                {recentRentals.map((rental) => (
                  <TableRow key={rental.id}>
                    <TableCell>{rental.id.slice(0, 8)}...</TableCell>
                    <TableCell>{rental.item.title}</TableCell>
                    <TableCell>{rental.renter.firstName} {rental.renter.lastName}</TableCell>
                    <TableCell>
                      <Chip color={getStatusColor(rental.status)} size="sm">
                        {rental.status}
                      </Chip>
                    </TableCell>
                    <TableCell>₱{rental.totalPrice}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      </div>
    </AdminLayout>
  );
}
