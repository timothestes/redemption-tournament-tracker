import { useRouter } from 'next/router';

export default function Layout({ children }) {
  const router = useRouter();

  return (
    <div>
      <header>
        <button onClick={() => router.push('/')}>Home</button>
      </header>
      <main>{children}</main>
    </div>
  );
}
