import { render, screen } from "@testing-library/react";
import StateRenderer from "./StateRenderer";

describe("StateRenderer", () => {
  test("renders submitting state", () => {
    render(<StateRenderer status="submitting" />);

    expect(
      screen.getByText(/submitting/i)
    ).toBeInTheDocument();
  });

  test("renders loading state", () => {
    render(<StateRenderer status="loading" />);

    expect(
      screen.getByText(/loading/i, { selector: "p" })
    ).toBeInTheDocument();
  });

  test("renders error state", () => {
    render(
      <StateRenderer
        status="error"
        error="Something went wrong"
      />
    );

    expect(
      screen.getByText(/something went wrong/i)
    ).toBeInTheDocument();
  });

  test("renders empty state", () => {
    render(
      <StateRenderer
        data={[]}
        empty={true}
      />
    );

    expect(
      screen.getByText(/no/i)
    ).toBeInTheDocument();
  });

  test("renders children when successful", () => {
    render(
      <StateRenderer
        status="success"
        data={[1]}
      >
        <div>Dashboard</div>
      </StateRenderer>
    );

    expect(
      screen.getByText("Dashboard")
    ).toBeInTheDocument();
  });

  //Since we added empty state customization, we need to test that as well
  //Test in the context of friend requests
  test("renders a customized empty state", () => {
    render(
      <StateRenderer
        status="success"
        data={[]}
        empty
        emptyTitle="No incoming requests"
        emptyDescription="You have no pending friend requests."
      />
    );

    expect(
      screen.getByText("No incoming requests")
    ).toBeInTheDocument();

    expect(
      screen.getByText("You have no pending friend requests.")
    ).toBeInTheDocument();
  });
});