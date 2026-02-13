import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the Todos header", () => {
  render(<App />);
  const title = screen.getByRole("heading", { name: /your tasks/i });
  expect(title).toBeInTheDocument();
});
