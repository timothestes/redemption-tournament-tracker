// pages/index.js
import { supabase } from '../utils/supabaseClient';

export default function Users({ users, error }) {
  if (error) {
    return <div>Error: {error.message}</div>;
  }

  return (
    <div>
      <h1>Users</h1>
      <ul>
        {users.map((user) => (
          <li key={user.id}>
            {user.username} - {user.email}
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function getServerSideProps() {
  const { data: users, error } = await supabase.from('users').select();

  return {
    props: {
      users: users || [],
      error: error || null,
    },
  };
}
