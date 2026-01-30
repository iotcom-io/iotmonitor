package monitor

import (
	"context"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

type ContainerInfo struct {
	ID     string   `json:"id"`
	Names  []string `json:"names"`
	Image  string   `json:"image"`
	State  string   `json:"state"`
	Status string   `json:"status"`
}

func GetDockerMetrics() ([]ContainerInfo, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, err
	}
	defer cli.Close()

	containers, err := cli.ContainerList(context.Background(), container.ListOptions{All: true})
	if err != nil {
		return nil, err
	}

	var metrics []ContainerInfo
	for _, container := range containers {
		metrics = append(metrics, ContainerInfo{
			ID:     container.ID,
			Names:  container.Names,
			Image:  container.Image,
			State:  container.State,
			Status: container.Status,
		})
	}

	return metrics, nil
}
