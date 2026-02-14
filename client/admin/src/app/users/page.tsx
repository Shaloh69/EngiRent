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
  Input,
  Pagination,
} from '@heroui/react';
import { Search, UserCheck, UserX } from 'lucide-react';
import api from '@/lib/api';
import type { User } from '@/types';

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await api.get('/users');
      setUsers(response.data.data?.users || []);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      await api.patch(`/users/${userId}`, { isActive: !currentStatus });
      fetchUsers();
    } catch (error) {
      console.error('Failed to update user status:', error);
    }
  };

  const filteredUsers = users.filter(user =>
    user.email.toLowerCase().includes(search.toLowerCase()) ||
    user.firstName.toLowerCase().includes(search.toLowerCase()) ||
    user.lastName.toLowerCase().includes(search.toLowerCase()) ||
    user.studentId.includes(search)
  );

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-3xl font-bold">User Management</h1>
          <Input
            placeholder="Search users..."
            startContent={<Search size={18} />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </div>

        <Table aria-label="Users table">
          <TableHeader>
            <TableColumn>NAME</TableColumn>
            <TableColumn>EMAIL</TableColumn>
            <TableColumn>STUDENT ID</TableColumn>
            <TableColumn>PHONE</TableColumn>
            <TableColumn>STATUS</TableColumn>
            <TableColumn>VERIFIED</TableColumn>
            <TableColumn>ACTIONS</TableColumn>
          </TableHeader>
          <TableBody>
            {filteredUsers.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.firstName} {user.lastName}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.studentId}</TableCell>
                <TableCell>{user.phoneNumber}</TableCell>
                <TableCell>
                  <Chip color={user.isActive ? 'success' : 'danger'} size="sm">
                    {user.isActive ? 'Active' : 'Inactive'}
                  </Chip>
                </TableCell>
                <TableCell>
                  <Chip color={user.isVerified ? 'success' : 'warning'} size="sm">
                    {user.isVerified ? 'Verified' : 'Unverified'}
                  </Chip>
                </TableCell>
                <TableCell>
                  <Button
                    size="sm"
                    color={user.isActive ? 'danger' : 'success'}
                    variant="flat"
                    startContent={user.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                    onClick={() => toggleUserStatus(user.id, user.isActive)}
                  >
                    {user.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </AdminLayout>
  );
}
