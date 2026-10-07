import { useState, useEffect, FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { 
  Users as UsersIcon, 
  Shield, 
  UserPlus, 
  ShieldCheck, 
  Edit2, 
  Key, 
  Trash2, 
  X, 
  Check, 
  AlertCircle,
  Loader2
} from 'lucide-react';

interface UserItem {
  id: number;
  username: string;
  role: 'administrator' | 'user';
  createdAt: string;
}

export default function Users() {
  const { user } = useOutletContext<{ user: any }>() || {};
  const [usersList, setUsersList] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Modal states
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);

  // Form states
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<'administrator' | 'user'>('user');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchUsers = async () => {
    if (user?.role !== 'administrator') return;
    try {
      setLoading(true);
      const res = await fetch('/api/users');
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        setUsersList(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Users fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [user]);

  const resetForm = () => {
    setFormUsername('');
    setFormPassword('');
    setFormRole('user');
    setFormError(null);
    setSelectedUser(null);
  };

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (formUsername.trim().length < 3) {
      setFormError('Username must be at least 3 characters');
      return;
    }
    if (!formPassword) {
      setFormError('Password is required');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formUsername.trim(),
          password: formPassword,
          role: formRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Failed to create user');
        return;
      }

      setShowAddModal(false);
      resetForm();
      setSuccessMsg(`User ${data.username} created successfully.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditUser = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setFormError(null);

    if (formUsername.trim().length < 3) {
      setFormError('Username must be at least 3 characters');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: formUsername.trim(),
          role: formRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Failed to update user');
        return;
      }

      setShowEditModal(false);
      resetForm();
      setSuccessMsg(`User ${data.username} updated successfully.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      fetchUsers();
    } catch (err: any) {
      setFormError(err.message || 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setFormError(null);

    if (!formPassword) {
      setFormError('New password is required');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: selectedUser.username,
          role: selectedUser.role,
          password: formPassword,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || 'Failed to update password');
        return;
      }

      setShowPasswordModal(false);
      resetForm();
      setSuccessMsg(`Password for ${selectedUser.username} changed successfully.`);
      setTimeout(() => setSuccessMsg(null), 4000);
    } catch (err: any) {
      setFormError(err.message || 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    try {
      setIsSubmitting(true);
      const res = await fetch(`/api/users/${selectedUser.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Failed to delete user');
        setTimeout(() => setErrorMsg(null), 4000);
        return;
      }

      setShowDeleteModal(false);
      resetForm();
      setSuccessMsg(`User account deleted.`);
      setTimeout(() => setSuccessMsg(null), 4000);
      fetchUsers();
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred');
      setTimeout(() => setErrorMsg(null), 4000);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (user?.role !== 'administrator') {
    return (
      <div className="p-10 flex flex-col items-center justify-center min-h-[50vh] text-center">
        <Shield className="w-12 h-12 text-rose-500 mb-3" />
        <h2 className="text-xl font-bold text-white mb-1">Access Restricted</h2>
        <p className="text-sm text-zinc-400">Only system administrators can access user management.</p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-5xl mx-auto space-y-8">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FF4FA3]/15 border border-[#FF4FA3]/30 text-[#FF4FA3] text-xs font-semibold uppercase tracking-wider mb-2">
            <UsersIcon className="w-3.5 h-3.5" />
            <span>Accounts & Roles</span>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">User Management</h1>
          <p className="text-sm text-zinc-400 mt-1">Manage registered accounts, grant administrator privileges, and update credentials.</p>
        </div>

        <button
          id="btn-add-user"
          onClick={() => {
            resetForm();
            setShowAddModal(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF4FA3] hover:bg-[#e0378b] text-white text-sm font-semibold shadow-lg shadow-[#FF4FA3]/20 transition-colors shrink-0"
        >
          <UserPlus className="w-4 h-4" />
          <span>Add New User</span>
        </button>
      </div>

      {/* Notifications */}
      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-sm flex items-center gap-3">
          <Check className="w-5 h-5 shrink-0 text-emerald-400" />
          <span>{successMsg}</span>
        </div>
      )}

      {errorMsg && (
        <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Users Table */}
      <div className="bg-[#141622] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#0E0F17] text-zinc-400 border-b border-white/5 text-xs font-semibold uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4">User</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Created Date</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {usersList.map(u => {
                const isCurrentUser = u.id === user.id;
                return (
                  <tr key={u.id} className="hover:bg-[#1A1C2C]/60 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-white/10 flex items-center justify-center text-xs font-bold text-white shrink-0">
                          {u.username?.[0]?.toUpperCase() || 'U'}
                        </div>
                        <div>
                          <div className="font-semibold text-white flex items-center gap-2">
                            <span>{u.username}</span>
                            {isCurrentUser && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-zinc-300 font-medium">You</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize inline-flex items-center gap-1.5 ${
                        u.role === 'administrator' 
                          ? 'bg-[#FF4FA3]/15 text-[#FF4FA3] border border-[#FF4FA3]/30' 
                          : 'bg-white/5 text-zinc-300 border border-white/10'
                      }`}>
                        {u.role === 'administrator' && <ShieldCheck className="w-3.5 h-3.5" />}
                        <span>{u.role}</span>
                      </span>
                    </td>

                    <td className="px-6 py-4 text-zinc-400 text-xs font-mono">
                      {new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>

                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          id={`btn-edit-user-${u.id}`}
                          onClick={() => {
                            setSelectedUser(u);
                            setFormUsername(u.username);
                            setFormRole(u.role);
                            setFormError(null);
                            setShowEditModal(true);
                          }}
                          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition-colors"
                          title="Edit User"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          id={`btn-pwd-user-${u.id}`}
                          onClick={() => {
                            setSelectedUser(u);
                            setFormPassword('');
                            setFormError(null);
                            setShowPasswordModal(true);
                          }}
                          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white transition-colors"
                          title="Change Password"
                        >
                          <Key className="w-4 h-4" />
                        </button>

                        {!isCurrentUser && (
                          <button
                            id={`btn-del-user-${u.id}`}
                            onClick={() => {
                              setSelectedUser(u);
                              setShowDeleteModal(true);
                            }}
                            className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 hover:text-rose-300 transition-colors"
                            title="Delete User"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}

              {!loading && usersList.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-10 text-center text-zinc-500 text-sm">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#141622] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Create New User</h2>
              <button onClick={() => setShowAddModal(false)} className="text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Username
                </label>
                <input
                  id="input-new-username"
                  type="text"
                  required
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  placeholder="e.g. singermike"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0F17] border border-white/10 text-white text-sm focus:outline-none focus:border-[#FF4FA3]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Password
                </label>
                <input
                  id="input-new-password"
                  type="password"
                  required
                  value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0F17] border border-white/10 text-white text-sm focus:outline-none focus:border-[#FF4FA3]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Role
                </label>
                <select
                  id="select-new-role"
                  value={formRole}
                  onChange={e => setFormRole(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0F17] border border-white/10 text-white text-sm focus:outline-none focus:border-[#FF4FA3]"
                >
                  <option value="user">User (Standard Access)</option>
                  <option value="administrator">Administrator (Full Access)</option>
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  id="btn-submit-create-user"
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#FF4FA3] hover:bg-[#e0378b] text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Create Account</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {showEditModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#141622] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Edit User: {selectedUser.username}</h2>
              <button onClick={() => setShowEditModal(false)} className="text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleEditUser} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Username
                </label>
                <input
                  id="input-edit-username"
                  type="text"
                  required
                  value={formUsername}
                  onChange={e => setFormUsername(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0F17] border border-white/10 text-white text-sm focus:outline-none focus:border-[#FF4FA3]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  Role
                </label>
                <select
                  id="select-edit-role"
                  value={formRole}
                  onChange={e => setFormRole(e.target.value as any)}
                  disabled={selectedUser.id === user.id}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0F17] border border-white/10 text-white text-sm focus:outline-none focus:border-[#FF4FA3] disabled:opacity-50"
                >
                  <option value="user">User (Standard Access)</option>
                  <option value="administrator">Administrator (Full Access)</option>
                </select>
                {selectedUser.id === user.id && (
                  <p className="text-[11px] text-zinc-500 mt-1">You cannot remove your own administrator role.</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  id="btn-submit-edit-user"
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#FF4FA3] hover:bg-[#e0378b] text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Save Changes</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showPasswordModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#141622] border border-white/10 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Change Password for {selectedUser.username}</h2>
              <button onClick={() => setShowPasswordModal(false)} className="text-zinc-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                {formError}
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-300 uppercase tracking-wider mb-1.5">
                  New Password
                </label>
                <input
                  id="input-change-password"
                  type="password"
                  required
                  value={formPassword}
                  onChange={e => setFormPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#0E0F17] border border-white/10 text-white text-sm focus:outline-none focus:border-[#FF4FA3]"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setShowPasswordModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  id="btn-submit-change-password"
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-[#FF4FA3] hover:bg-[#e0378b] text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>Update Password</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {showDeleteModal && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#141622] border border-rose-500/20 rounded-2xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center gap-3 text-rose-400">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 flex items-center justify-center">
                <Trash2 className="w-5 h-5" />
              </div>
              <h2 className="text-lg font-bold text-white">Delete User Account</h2>
            </div>

            <p className="text-sm text-zinc-300">
              Are you sure you want to delete <span className="font-semibold text-white">{selectedUser.username}</span>? This action cannot be undone.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-delete-user"
                onClick={handleDeleteUser}
                disabled={isSubmitting}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Delete User</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
