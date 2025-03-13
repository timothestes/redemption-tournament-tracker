import Header from "../../components/header";
import SideNav from "../../components/side-nav";

export default function TournamentsLayout({ children }) {
  return (
    <>
      <SideNav />
      <div className="flex-1 w-full overflow-hidden flex flex-col gap-9 items-center">
        <Header />
        <div className="flex flex-col w-full">
          <div className="w-full flex">{children}</div>
        </div>
        {/* Insert footer here! */}
        {/* <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs py-16"> */}
        {/* <p>Switch theme</p> */}
        {/* <ThemeSwitcher /> */}
        {/* </footer> */}
      </div>
    </>
  );
}
