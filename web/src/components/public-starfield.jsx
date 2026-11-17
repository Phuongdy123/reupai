// Fixed coordinates keep the server and first browser render identical.
const farStars = [
  [4, 11, 1, .32], [12, 39, 1, .24], [19, 17, 1.5, .35], [27, 57, 1, .22],
  [34, 9, 1, .3], [42, 32, 1, .22], [48, 72, 1.5, .28], [54, 19, 1, .32],
  [61, 48, 1, .28], [68, 7, 1.5, .27], [76, 29, 1, .33], [84, 64, 1, .23],
  [92, 16, 1.5, .3], [97, 47, 1, .26], [8, 77, 1, .3], [24, 89, 1.5, .22],
  [38, 64, 1, .32], [57, 92, 1, .25], [72, 83, 1, .3], [90, 94, 1.5, .26],
];

const nearStars = [
  [7, 28, 1.5, .46], [16, 65, 2, .34], [30, 34, 1.5, .38], [44, 13, 1.5, .42],
  [59, 59, 2, .3], [73, 39, 1.5, .47], [88, 9, 2, .35], [95, 75, 1.5, .44],
  [37, 85, 1.5, .36], [79, 96, 1.5, .38],
];

function StarLayer({ stars, near = false }) {
  return <div className={`public-starfield-layer ${near ? "is-near" : "is-far"}`}>
    {stars.map(([x, y, size, opacity], index) => <span className="public-star" key={index}
      style={{ left: `${x}%`, top: `${y}%`, width: `${size}px`, height: `${size}px`, opacity }} />)}
  </div>;
}

export function PublicStarfield({ className = "" }) {
  return <div className={`public-starfield ${className}`.trim()} aria-hidden="true">
    <StarLayer stars={farStars} />
    <StarLayer stars={nearStars} near />
    <div className="public-starfield-layer is-streaks">
      <span className="public-shooting-star" />
      <span className="public-shooting-star is-second" />
    </div>
  </div>;
}
