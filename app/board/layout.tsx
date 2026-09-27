import "./board.css";

/** Sets the stored theme before the first paint so the board never flashes the wrong look. */
const themeScript = `try{if(localStorage.getItem("board-theme")==="dark"){document.currentScript.parentElement.setAttribute("data-theme","dark")}}catch(e){}`;

export default function BoardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="board-root" data-theme="light" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      {children}
    </div>
  );
}
