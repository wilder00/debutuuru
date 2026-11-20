//! Lane assignment for the commit graph.
//!
//! Input: commits in topological order (children before parents), as given by
//! `git log --topo-order`. Output: one [`GraphRow`] per commit describing which
//! lines the UI must draw in that row.
//!
//! Row geometry (the renderer only needs these four things):
//! * `through`  – lanes that run straight from the top to the bottom of the row
//! * `incoming` – lanes arriving from above and ending at the commit node
//! * `outgoing` – edges from the node to the bottom of the row (one per parent)
//! * `lane`     – the column of the node itself

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Edge {
    pub from: usize,
    pub to: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GraphRow {
    pub lane: usize,
    pub incoming: Vec<usize>,
    pub through: Vec<usize>,
    pub outgoing: Vec<Edge>,
    /// Number of columns needed to draw this row.
    pub width: usize,
}

pub fn layout(commits: &[(String, Vec<String>)]) -> Vec<GraphRow> {
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut rows = Vec::with_capacity(commits.len());

    for (hash, parents) in commits {
        let incoming: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, l)| l.as_deref() == Some(hash.as_str()))
            .map(|(i, _)| i)
            .collect();
        let lane = match incoming.first() {
            Some(&i) => i,
            None => free_slot(&mut lanes),
        };
        for &i in &incoming {
            lanes[i] = None;
        }
        let through: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, l)| l.is_some())
            .map(|(i, _)| i)
            .collect();

        let mut outgoing = Vec::new();
        for (k, parent) in parents.iter().enumerate() {
            if k == 0 {
                lanes[lane] = Some(parent.clone());
                outgoing.push(Edge {
                    from: lane,
                    to: lane,
                });
            } else if let Some(j) = lanes.iter().position(|l| l.as_deref() == Some(parent)) {
                outgoing.push(Edge { from: lane, to: j });
            } else {
                let slot = free_slot(&mut lanes);
                lanes[slot] = Some(parent.clone());
                outgoing.push(Edge {
                    from: lane,
                    to: slot,
                });
            }
        }

        let mut width = lane + 1;
        for &i in incoming.iter().chain(through.iter()) {
            width = width.max(i + 1);
        }
        for e in &outgoing {
            width = width.max(e.to + 1);
        }
        rows.push(GraphRow {
            lane,
            incoming,
            through,
            outgoing,
            width,
        });

        while matches!(lanes.last(), Some(None)) {
            lanes.pop();
        }
    }
    rows
}

fn free_slot(lanes: &mut Vec<Option<String>>) -> usize {
    match lanes.iter().position(|l| l.is_none()) {
        Some(i) => i,
        None => {
            lanes.push(None);
            lanes.len() - 1
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(h: &str, p: &[&str]) -> (String, Vec<String>) {
        (h.to_string(), p.iter().map(|s| s.to_string()).collect())
    }

    #[test]
    fn linear_history_stays_in_lane_zero() {
        let rows = layout(&[c("c", &["b"]), c("b", &["a"]), c("a", &[])]);
        assert!(rows.iter().all(|r| r.lane == 0 && r.width == 1));
        assert_eq!(rows[0].outgoing, vec![Edge { from: 0, to: 0 }]);
        assert!(rows[2].outgoing.is_empty());
    }

    #[test]
    fn merge_opens_and_closes_a_lane() {
        // m merges p1 and p2, both children of r.
        let rows = layout(&[
            c("m", &["p1", "p2"]),
            c("p1", &["r"]),
            c("p2", &["r"]),
            c("r", &[]),
        ]);
        assert_eq!(
            rows[0].outgoing,
            vec![Edge { from: 0, to: 0 }, Edge { from: 0, to: 1 }]
        );
        assert_eq!(rows[1].lane, 0);
        assert_eq!(rows[1].through, vec![1]);
        assert_eq!(rows[2].lane, 1);
        assert_eq!(rows[2].through, vec![0]);
        assert_eq!(rows[3].incoming, vec![0, 1]);
        assert_eq!(rows[3].width, 2);
    }
}
