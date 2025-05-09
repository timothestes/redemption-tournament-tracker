export default function Header() {
  return (
    <div className="flex flex-col gap-6 items-center text-center">
      <div className="flex gap-8 justify-center items-center">
      </div>
      <h1 className="sr-only">Welcome message</h1>
      <p className="text-3xl lg:text-4xl !leading-tight mx-auto max-w-xl text-center">
        A new way to host{" "}
        <span className="font-bold text-4xl lg:text-5xl">
          Redemption Tournaments
        </span>
      </p>
      <div className="w-full p-[1px] bg-gradient-to-r from-transparent via-foreground/10 to-transparent my-4" />
    </div>
  );
}
