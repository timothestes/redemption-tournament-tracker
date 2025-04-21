import Header from "../../components/header";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="w-full flex flex-col gap-4 items-start">
      <div className="flex-1 w-full overflow-hidden flex flex-col gap-4 items-center">
        <Header />
        {children}
      </div>
    </div>
  );
}
